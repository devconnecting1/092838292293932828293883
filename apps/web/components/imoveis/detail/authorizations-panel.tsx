"use client"

import * as React from "react"
import Link from "next/link"
import { FileSignatureIcon, Trash2Icon, TriangleAlertIcon, UsersIcon } from "lucide-react"

import { Alert, AlertDescription, AlertTitle } from "@workspace/ui/components/alert"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@workspace/ui/components/alert-dialog"
import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@workspace/ui/components/empty"
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
} from "@workspace/ui/components/item"
import { Spinner } from "@workspace/ui/components/spinner"
import { toast } from "@workspace/ui/components/toast"

import {
  AuthorizationDialog,
  type OwnerSelectOption,
} from "@/components/imoveis/detail/authorization-dialog"
import { formatDate } from "@/lib/format"
import { formatDateOnly, formatPercent } from "@/components/imoveis/detail/format"
import { propertyTabHref } from "@/components/imoveis/detail/tabs"
import type { AuthorizationItem } from "@/components/imoveis/detail/types"
import { removeAuthorizationAction } from "@/lib/imoveis/authorization-actions"
import { isAuthorizationActive, isAuthorizationExpired } from "@/lib/imoveis/mappers"

type Period = { starts_on: string; ends_on: string | null }

function toPeriod(item: AuthorizationItem): Period {
  return { starts_on: item.startsOn, ends_on: item.endsOn }
}

function formatValidity(item: AuthorizationItem) {
  return item.endsOn
    ? `${formatDateOnly(item.startsOn)} a ${formatDateOnly(item.endsOn)}`
    : `A partir de ${formatDateOnly(item.startsOn)}, sem prazo final`
}

export function AuthorizationsPanel({
  propertyId,
  authorizations,
  ownerOptions,
  today,
  canEdit,
  canDelete,
}: {
  propertyId: string
  authorizations: AuthorizationItem[]
  ownerOptions: OwnerSelectOption[]
  /** AAAA-MM-DD em São Paulo, calculado no servidor (evita divergência na hidratação). */
  today: string
  canEdit: boolean
  canDelete: boolean
}) {
  const hasActive = authorizations.some((item) => isAuthorizationActive(toPeriod(item), today))
  const hasOwners = ownerOptions.length > 0

  return (
    <div className="flex flex-col gap-4">
      {!hasActive ? (
        <Alert variant={authorizations.length > 0 ? "destructive" : "warning"}>
          <TriangleAlertIcon />
          <AlertTitle>Nenhuma autorização vigente</AlertTitle>
          <AlertDescription>
            Uma autorização de venda ou locação vigente dá segurança para anunciar e vale 10 pontos
            na Nota do Anúncio.
          </AlertDescription>
        </Alert>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Autorizações</CardTitle>
          <CardDescription>
            Autorizações do proprietário para anunciar e negociar o imóvel.
          </CardDescription>
          {canEdit && hasOwners ? (
            <CardAction>
              <AuthorizationDialog
                propertyId={propertyId}
                ownerOptions={ownerOptions}
                today={today}
              />
            </CardAction>
          ) : null}
        </CardHeader>
        <CardContent>
          {authorizations.length === 0 ? (
            hasOwners ? (
              <Empty className="border">
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <FileSignatureIcon />
                  </EmptyMedia>
                  <EmptyTitle>Nenhuma autorização registrada</EmptyTitle>
                  <EmptyDescription>
                    Registre o período, a exclusividade e a comissão combinados com o proprietário.
                  </EmptyDescription>
                </EmptyHeader>
                {canEdit ? (
                  <EmptyContent>
                    <AuthorizationDialog
                      propertyId={propertyId}
                      ownerOptions={ownerOptions}
                      today={today}
                    />
                  </EmptyContent>
                ) : null}
              </Empty>
            ) : (
              <Empty className="border">
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <UsersIcon />
                  </EmptyMedia>
                  <EmptyTitle>Cadastre os proprietários primeiro</EmptyTitle>
                  <EmptyDescription>
                    A autorização é assinada por um proprietário do imóvel. Vincule os proprietários
                    na aba Proprietários.
                  </EmptyDescription>
                </EmptyHeader>
                <EmptyContent>
                  <Button
                    variant="outline"
                    render={
                      <Link href={propertyTabHref(propertyId, "proprietarios")} scroll={false} />
                    }
                    nativeButton={false}
                  >
                    <UsersIcon data-icon="inline-start" />
                    Ir para Proprietários
                  </Button>
                </EmptyContent>
              </Empty>
            )
          ) : (
            <ItemGroup className="gap-2">
              {authorizations.map((item) => {
                const period = toPeriod(item)
                const active = isAuthorizationActive(period, today)
                const expired = isAuthorizationExpired(period, today)

                return (
                  <Item key={item.id} variant="outline" size="sm">
                    <ItemContent className="min-w-0">
                      <ItemTitle className="flex-wrap">
                        {item.ownerName ? (
                          <Link
                            href={`/clientes/${item.ownerClientId}`}
                            className="hover:underline"
                          >
                            {item.ownerName}
                          </Link>
                        ) : (
                          <span className="text-muted-foreground">Cliente sem acesso</span>
                        )}
                        {active ? <Badge>Vigente</Badge> : null}
                        {expired ? <Badge variant="destructive">Vencida</Badge> : null}
                        {!active && !expired ? <Badge variant="outline">Agendada</Badge> : null}
                        <Badge variant={item.exclusive ? "secondary" : "outline"}>
                          {item.exclusive ? "Exclusiva" : "Sem exclusividade"}
                        </Badge>
                      </ItemTitle>
                      <ItemDescription className="line-clamp-none">
                        Vigência: {formatValidity(item)} · Comissão:{" "}
                        {formatPercent(item.commissionPercent)} ·{" "}
                        {item.signedAt
                          ? `Assinada em ${formatDate(item.signedAt)}`
                          : "Assinatura não registrada"}
                        {item.hasDocument ? " · Documento anexado" : ""}
                      </ItemDescription>
                    </ItemContent>
                    {canEdit || canDelete ? (
                      <ItemActions>
                        {canEdit ? (
                          <AuthorizationDialog
                            propertyId={propertyId}
                            ownerOptions={ownerOptions}
                            today={today}
                            authorization={item}
                          />
                        ) : null}
                        {canDelete ? (
                          <RemoveAuthorizationButton propertyId={propertyId} authorization={item} />
                        ) : null}
                      </ItemActions>
                    ) : null}
                  </Item>
                )
              })}
            </ItemGroup>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function RemoveAuthorizationButton({
  propertyId,
  authorization,
}: {
  propertyId: string
  authorization: AuthorizationItem
}) {
  const [open, setOpen] = React.useState(false)
  const [isPending, startTransition] = React.useTransition()

  function handleConfirm() {
    startTransition(async () => {
      const result = await removeAuthorizationAction(propertyId, authorization.id)

      if (result.ok) {
        setOpen(false)
        toast.add({
          title: result.message ?? "Autorização removida.",
          type: "success",
        })
      } else {
        toast.add({
          title: "Não foi possível remover a autorização",
          description: result.error,
          type: "error",
        })
      }
    })
  }

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger render={<Button variant="ghost" size="icon-sm" />}>
        <Trash2Icon />
        <span className="sr-only">Remover autorização</span>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Remover autorização?</AlertDialogTitle>
          <AlertDialogDescription>
            A autorização de {authorization.ownerName ?? "proprietário sem acesso"} (
            {formatValidity(authorization)}) será apagada e a Nota do Anúncio será recalculada.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isPending}>Cancelar</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={handleConfirm} disabled={isPending}>
            {isPending ? <Spinner data-icon="inline-start" /> : null}
            Remover
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

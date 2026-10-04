"use client"

import * as React from "react"
import { EyeIcon, LockIcon, UserPlusIcon, XIcon } from "lucide-react"

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@workspace/ui/components/alert-dialog"
import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"
import { Field, FieldContent, FieldDescription, FieldLabel } from "@workspace/ui/components/field"
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
} from "@workspace/ui/components/item"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select"
import { Spinner } from "@workspace/ui/components/spinner"
import { Switch } from "@workspace/ui/components/switch"
import { toast } from "@workspace/ui/components/toast"

import type {
  PropertyAccessPerson,
  PropertyShareCandidate,
} from "@/components/imoveis/detail/types"
import {
  setPropertyRestrictedAction,
  sharePropertyAction,
  unsharePropertyAction,
} from "@/lib/imoveis/privacy-actions"

function RestrictionSwitch({
  propertyId,
  restricted,
}: {
  propertyId: string
  restricted: boolean
}) {
  const [confirming, setConfirming] = React.useState(false)
  const [isPending, startTransition] = React.useTransition()
  const next = !restricted

  function confirm() {
    startTransition(async () => {
      const result = await setPropertyRestrictedAction(propertyId, next)

      if (!result.ok) {
        toast.add({
          title: "Não foi possível mudar o sigilo",
          description: result.error,
          type: "error",
        })
        return
      }

      toast.add({ title: result.message ?? "Sigilo atualizado.", type: "success" })
      setConfirming(false)
    })
  }

  return (
    <>
      <Field orientation="horizontal">
        <FieldContent>
          <FieldLabel htmlFor="imovel-restrito">Imóvel restrito</FieldLabel>
          <FieldDescription>
            Esconde o imóvel, as fotos, os proprietários, as chaves, as propostas e os documentos de
            quem não está na lista.
          </FieldDescription>
        </FieldContent>
        <Switch
          id="imovel-restrito"
          checked={restricted}
          onCheckedChange={() => setConfirming(true)}
          disabled={isPending}
        />
      </Field>

      <AlertDialog open={confirming} onOpenChange={(open) => !isPending && setConfirming(open)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {next ? "Tornar o imóvel restrito?" : "Tirar o sigilo do imóvel?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {next
                ? "Só o dono, o gerente, o captador, o corretor responsável e as pessoas escolhidas vão ver o imóvel e tudo o que está ligado a ele. Ele sai dos portais e da página pública."
                : "Toda a equipe volta a ver o imóvel, as fotos, os proprietários, as chaves, as propostas e os documentos. A publicação nos portais continua desligada até alguém ligar."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isPending}>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={confirm} disabled={isPending}>
              {isPending ? <Spinner data-icon="inline-start" /> : null}
              {next ? "Tornar restrito" : "Tirar o sigilo"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

function AddPersonField({
  propertyId,
  candidates,
}: {
  propertyId: string
  candidates: PropertyShareCandidate[]
}) {
  const [memberId, setMemberId] = React.useState<string | null>(null)
  const [isPending, startTransition] = React.useTransition()
  const items = candidates.map((candidate) => ({
    label: `${candidate.name} · ${candidate.roleLabel}`,
    value: candidate.userId as string | null,
  }))

  function share() {
    if (!memberId) return

    startTransition(async () => {
      const result = await sharePropertyAction(propertyId, memberId)

      if (!result.ok) {
        toast.add({
          title: "Não foi possível liberar o acesso",
          description: result.error,
          type: "error",
        })
        return
      }

      toast.add({ title: result.message ?? "Acesso liberado.", type: "success" })
      setMemberId(null)
    })
  }

  if (candidates.length === 0) {
    return <p className="text-sm text-muted-foreground">Toda a equipe ativa já vê este imóvel.</p>
  }

  return (
    <Field>
      <FieldLabel htmlFor="imovel-compartilhar">Liberar para mais alguém</FieldLabel>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Select
          items={items}
          value={memberId}
          onValueChange={(value: string | null) => setMemberId(value)}
          disabled={isPending}
        >
          <SelectTrigger id="imovel-compartilhar" className="w-full sm:flex-1">
            <SelectValue placeholder="Escolha a pessoa" />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {items.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
        <Button type="button" onClick={share} disabled={!memberId || isPending}>
          {isPending ? (
            <Spinner data-icon="inline-start" />
          ) : (
            <UserPlusIcon data-icon="inline-start" />
          )}
          Liberar acesso
        </Button>
      </div>
      <FieldDescription>
        A pessoa passa a ver o imóvel, mas não edita nem muda o sigilo.
      </FieldDescription>
    </Field>
  )
}

function RemovePersonButton({
  propertyId,
  person,
}: {
  propertyId: string
  person: PropertyAccessPerson
}) {
  const [isPending, startTransition] = React.useTransition()

  function remove() {
    startTransition(async () => {
      const result = await unsharePropertyAction(propertyId, person.userId)

      if (!result.ok) {
        toast.add({
          title: "Não foi possível remover o acesso",
          description: result.error,
          type: "error",
        })
        return
      }

      toast.add({ title: result.message ?? "Acesso removido.", type: "success" })
    })
  }

  return (
    <Button variant="ghost" size="icon-sm" onClick={remove} disabled={isPending}>
      {isPending ? <Spinner /> : <XIcon />}
      <span className="sr-only">Remover o acesso de {person.name}</span>
    </Button>
  )
}

/**
 * Sigilo do imóvel na ficha: liga/desliga o "Restrito" e mostra quem vê.
 * Quem gerencia (dono, gerente, captador, corretor responsável) muda; os
 * demais só consultam.
 */
export function PrivacyCard({
  propertyId,
  restricted,
  canManage,
  people,
  candidates,
}: {
  propertyId: string
  restricted: boolean
  canManage: boolean
  people: PropertyAccessPerson[]
  candidates: PropertyShareCandidate[]
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          Sigilo
          {restricted ? (
            <Badge variant="secondary">
              <LockIcon data-icon="inline-start" />
              Restrito
            </Badge>
          ) : (
            <Badge variant="outline">
              <EyeIcon data-icon="inline-start" />
              Equipe toda
            </Badge>
          )}
        </CardTitle>
        <CardDescription>
          {restricted
            ? "Só as pessoas abaixo veem este imóvel. Ele não vai para os portais nem para a página pública."
            : "Toda a equipe vê este imóvel."}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {canManage ? <RestrictionSwitch propertyId={propertyId} restricted={restricted} /> : null}

        {restricted ? (
          <>
            <ItemGroup className="gap-2">
              {people.map((person) => (
                <Item key={person.userId} variant="outline" size="sm">
                  <ItemContent className="min-w-0">
                    <ItemTitle>{person.name}</ItemTitle>
                    <ItemDescription>
                      {person.roleLabel} · {person.reason}
                    </ItemDescription>
                  </ItemContent>
                  {canManage && person.removable ? (
                    <ItemActions>
                      <RemovePersonButton propertyId={propertyId} person={person} />
                    </ItemActions>
                  ) : null}
                </Item>
              ))}
            </ItemGroup>
            {canManage ? <AddPersonField propertyId={propertyId} candidates={candidates} /> : null}
          </>
        ) : null}
      </CardContent>
    </Card>
  )
}

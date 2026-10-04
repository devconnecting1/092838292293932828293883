"use client"

import * as React from "react"
import {
  CopyIcon,
  MailIcon,
  MessageCircleIcon,
  MoreHorizontalIcon,
  RefreshCwIcon,
  Trash2Icon,
} from "lucide-react"

import { APP_ROLE_LABELS, type AppRole } from "@workspace/core/properties/enums"
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu"
import {
  Empty,
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

import { renewInvitation, revokeInvitation } from "@/app/(app)/configuracoes/equipe/actions"
import { useCopyToClipboard } from "@/components/configuracoes/copy-field"
import { getInvitationShareLinks } from "@/components/configuracoes/invitation-share"
import { INVITATION_VALIDITY_DAYS } from "@/lib/configuracoes/invitations"
import { canManageRole } from "@/lib/configuracoes/roles"
import { formatDateTime } from "@/lib/format"

export type PendingInvitation = {
  id: string
  email: string
  role: AppRole
  url: string
  expiresAt: string
  /** Calculado no servidor, para o HTML inicial bater com o do navegador. */
  expired: boolean
}

export function PendingInvitations({
  invitations,
  actorRole,
  organizationName,
}: {
  invitations: PendingInvitation[]
  actorRole: AppRole
  organizationName: string
}) {
  if (invitations.length === 0) {
    return (
      <Empty className="border">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <MailIcon />
          </EmptyMedia>
          <EmptyTitle>Nenhum convite pendente</EmptyTitle>
          <EmptyDescription>
            Use “Convidar pessoa” para gerar um link de convite. Convites aceitos saem desta lista e
            a pessoa aparece em Membros.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }

  return (
    <ItemGroup className="gap-2">
      {invitations.map((invitation) => (
        <InvitationItem
          key={`${invitation.id}-${invitation.expiresAt}`}
          invitation={invitation}
          actorRole={actorRole}
          organizationName={organizationName}
        />
      ))}
    </ItemGroup>
  )
}

function InvitationItem({
  invitation,
  actorRole,
  organizationName,
}: {
  invitation: PendingInvitation
  actorRole: AppRole
  organizationName: string
}) {
  const [revokeOpen, setRevokeOpen] = React.useState(false)
  const [isPending, startTransition] = React.useTransition()
  const { copy } = useCopyToClipboard()

  const canManage = canManageRole(actorRole, invitation.role)
  const { whatsappUrl, mailtoUrl } = getInvitationShareLinks(invitation, organizationName)

  function onRenew() {
    startTransition(async () => {
      const result = await renewInvitation(invitation.id)

      toast.add(
        result.ok
          ? { title: result.message ?? "Convite renovado.", type: "success" }
          : {
              title: "Não foi possível renovar",
              description: result.error,
              type: "error",
            }
      )
    })
  }

  function onRevoke() {
    startTransition(async () => {
      const result = await revokeInvitation(invitation.id)

      if (result.ok) {
        setRevokeOpen(false)
        toast.add({
          title: result.message ?? "Convite revogado.",
          type: "success",
        })
        return
      }

      toast.add({
        title: "Não foi possível revogar",
        description: result.error,
        type: "error",
      })
    })
  }

  return (
    <Item variant="outline">
      <ItemContent>
        <ItemTitle>
          <span className="truncate">{invitation.email}</span>
          <Badge variant="secondary">{APP_ROLE_LABELS[invitation.role]}</Badge>
          {invitation.expired ? <Badge variant="destructive">Expirado</Badge> : null}
        </ItemTitle>
        <ItemDescription>
          {invitation.expired
            ? `Expirou em ${formatDateTime(invitation.expiresAt)}. Renove para o link voltar a funcionar.`
            : `Expira em ${formatDateTime(invitation.expiresAt)}.`}
        </ItemDescription>
      </ItemContent>
      <ItemActions>
        {canManage ? (
          <>
            {invitation.expired ? (
              <Button variant="outline" size="sm" disabled={isPending} onClick={onRenew}>
                {isPending ? (
                  <Spinner data-icon="inline-start" />
                ) : (
                  <RefreshCwIcon data-icon="inline-start" />
                )}
                Renovar
              </Button>
            ) : (
              <Button
                variant="outline"
                size="sm"
                onClick={() => copy(invitation.url, "Link do convite copiado.")}
              >
                <CopyIcon data-icon="inline-start" />
                Copiar link
              </Button>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger
                render={<Button variant="ghost" size="icon-sm" disabled={isPending} />}
              >
                <MoreHorizontalIcon />
                <span className="sr-only">Mais ações do convite de {invitation.email}</span>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuGroup>
                  <DropdownMenuItem
                    onClick={() => copy(invitation.url, "Link do convite copiado.")}
                  >
                    <CopyIcon />
                    Copiar link
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    render={<a href={whatsappUrl} target="_blank" rel="noopener noreferrer" />}
                  >
                    <MessageCircleIcon />
                    Enviar pelo WhatsApp
                  </DropdownMenuItem>
                  <DropdownMenuItem render={<a href={mailtoUrl} />}>
                    <MailIcon />
                    Enviar por e-mail
                  </DropdownMenuItem>
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
                <DropdownMenuGroup>
                  <DropdownMenuItem onClick={onRenew}>
                    <RefreshCwIcon />
                    Renovar por {INVITATION_VALIDITY_DAYS} dias
                  </DropdownMenuItem>
                  <DropdownMenuItem variant="destructive" onClick={() => setRevokeOpen(true)}>
                    <Trash2Icon />
                    Revogar convite
                  </DropdownMenuItem>
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
            <AlertDialog
              open={revokeOpen}
              onOpenChange={(open) => {
                if (!isPending) setRevokeOpen(open)
              }}
            >
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Revogar o convite de {invitation.email}?</AlertDialogTitle>
                  <AlertDialogDescription>
                    O link deixa de funcionar na hora. Se mudar de ideia, será preciso gerar um novo
                    convite.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel disabled={isPending}>Cancelar</AlertDialogCancel>
                  <AlertDialogAction variant="destructive" disabled={isPending} onClick={onRevoke}>
                    {isPending ? <Spinner data-icon="inline-start" /> : null}
                    Revogar convite
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </>
        ) : (
          <Badge variant="outline">Só o dono gerencia</Badge>
        )}
      </ItemActions>
    </Item>
  )
}

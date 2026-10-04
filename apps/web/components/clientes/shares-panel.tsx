"use client"

import * as React from "react"
import { Share2Icon, UserPlusIcon } from "lucide-react"

import { Button } from "@workspace/ui/components/button"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@workspace/ui/components/empty"
import { Field, FieldDescription, FieldLabel } from "@workspace/ui/components/field"
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
import { toast } from "@workspace/ui/components/toast"

import { ConfirmDeleteButton } from "@/components/clientes/confirm-delete-button"
import type { Role } from "@/lib/auth/roles"
import { formatDate } from "@/lib/format"
import { canRemoveClientShare } from "@/lib/clientes/permissions"
import { addClientShare, removeClientShare } from "@/lib/clientes/share-actions"

export type ShareRowView = {
  id: string
  userName: string
  roleLabel: string | null
  sharedBy: string | null
  sharedByName: string
  createdAt: string
}

type SharesPanelProps = {
  clientId: string
  shares: ShareRowView[]
  /** Corretores e captadores que ainda não têm acesso. */
  candidates: { id: string; label: string }[]
  currentUserId: string
  role: Role
}

export function SharesPanel({
  clientId,
  shares,
  candidates,
  currentUserId,
  role,
}: SharesPanelProps) {
  const [selectedUserId, setSelectedUserId] = React.useState<string | null>(null)
  const [isPending, startTransition] = React.useTransition()

  const items = [
    { label: "Selecione um colega", value: null },
    ...candidates.map((candidate) => ({
      label: candidate.label,
      value: candidate.id,
    })),
  ]

  function share() {
    if (!selectedUserId) return

    startTransition(async () => {
      const result = await addClientShare(clientId, selectedUserId)

      if (!result.ok) {
        toast.add({ title: result.error, type: "error" })
        return
      }

      toast.add({
        title: result.message ?? "Cliente compartilhado.",
        type: "success",
      })
      setSelectedUserId(null)
    })
  }

  return (
    <div className="flex flex-col gap-6">
      <Field>
        <FieldLabel htmlFor="compartilhar-colega">Compartilhar com</FieldLabel>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Select
            items={items}
            value={selectedUserId}
            onValueChange={(value) => setSelectedUserId(value)}
            disabled={candidates.length === 0 || isPending}
          >
            <SelectTrigger id="compartilhar-colega" className="w-full sm:max-w-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {candidates.map((candidate) => (
                  <SelectItem key={candidate.id} value={candidate.id}>
                    {candidate.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
          <Button onClick={share} disabled={!selectedUserId || isPending}>
            {isPending ? (
              <Spinner data-icon="inline-start" />
            ) : (
              <UserPlusIcon data-icon="inline-start" />
            )}
            Compartilhar
          </Button>
        </div>
        <FieldDescription>
          {candidates.length === 0
            ? "Todos os corretores e captadores já têm acesso a este cliente."
            : "Corretores e captadores passam a ver e editar este cliente. Dono, gerente e assistente já veem todos."}
        </FieldDescription>
      </Field>

      {shares.length === 0 ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Share2Icon />
            </EmptyMedia>
            <EmptyTitle>Não compartilhado</EmptyTitle>
            <EmptyDescription>Só o responsável e a gestão acessam este cliente.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <ItemGroup className="gap-2">
          {shares.map((share) => (
            <Item key={share.id} variant="outline" role="listitem">
              <ItemContent>
                <ItemTitle>
                  {share.userName}
                  {share.roleLabel ? (
                    <span className="font-normal text-muted-foreground">{share.roleLabel}</span>
                  ) : null}
                </ItemTitle>
                <ItemDescription>
                  Compartilhado por {share.sharedByName} em {formatDate(share.createdAt)}
                </ItemDescription>
              </ItemContent>
              {canRemoveClientShare(role, share.sharedBy, currentUserId) ? (
                <ItemActions>
                  <ConfirmDeleteButton
                    action={() => removeClientShare(share.id, clientId)}
                    label={`Remover acesso de ${share.userName}`}
                    title="Remover este compartilhamento?"
                    description={`${share.userName} deixa de ver este cliente, a menos que seja o responsável.`}
                    confirmLabel="Remover acesso"
                  />
                </ItemActions>
              ) : null}
            </Item>
          ))}
        </ItemGroup>
      )}
    </div>
  )
}

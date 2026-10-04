"use client"

import * as React from "react"
import { UserCheckIcon, UserXIcon } from "lucide-react"

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
  AlertDialogTrigger,
} from "@workspace/ui/components/alert-dialog"
import { Avatar, AvatarFallback, AvatarImage } from "@workspace/ui/components/avatar"
import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select"
import { Spinner } from "@workspace/ui/components/spinner"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@workspace/ui/components/table"
import { toast } from "@workspace/ui/components/toast"

import { setMemberActive, updateMemberRole } from "@/app/(app)/configuracoes/equipe/actions"
import { CreciStatusBadge } from "@/components/configuracoes/creci-status-badge"
import { getInitials } from "@/components/crm/utils"
import { formatDateOnly } from "@/lib/configuracoes/dates"
import { canManageRole, getAssignableRoles, getRoleSelectItems } from "@/lib/configuracoes/roles"

export type TeamMember = {
  membershipId: string
  name: string | null
  email: string | null
  avatarUrl: string | null
  role: AppRole
  active: boolean
  creciNumber: string | null
  creciState: string | null
  creciValidUntil: string | null
  isCurrentUser: boolean
}

export function TeamMembersTable({
  members,
  actorRole,
  today,
}: {
  members: TeamMember[]
  actorRole: AppRole
  /** Hoje em Brasília (AAAA-MM-DD), calculado no servidor. */
  today: string
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Pessoa</TableHead>
          <TableHead>Papel</TableHead>
          <TableHead>CRECI</TableHead>
          <TableHead>Acesso</TableHead>
          <TableHead>
            <span className="sr-only">Ações</span>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {members.map((member) => (
          // A chave inclui papel e acesso: depois do revalidatePath a linha
          // remonta com os valores do servidor.
          <MemberRow
            key={`${member.membershipId}-${member.role}-${member.active}`}
            member={member}
            actorRole={actorRole}
            today={today}
          />
        ))}
      </TableBody>
    </Table>
  )
}

function MemberRow({
  member,
  actorRole,
  today,
}: {
  member: TeamMember
  actorRole: AppRole
  today: string
}) {
  const [role, setRole] = React.useState<AppRole>(member.role)
  const [confirmOpen, setConfirmOpen] = React.useState(false)
  const [isPending, startTransition] = React.useTransition()

  const displayName = member.name ?? member.email ?? "Sem nome"
  const canManage = !member.isCurrentUser && canManageRole(actorRole, member.role)
  const roleItems = getRoleSelectItems(getAssignableRoles(actorRole))

  function onRoleChange(next: AppRole | null) {
    if (!next || next === role) return

    const previous = role
    setRole(next)

    startTransition(async () => {
      const result = await updateMemberRole(member.membershipId, next)

      if (result.ok) {
        toast.add({
          title: result.message ?? "Papel atualizado.",
          type: "success",
        })
        return
      }

      setRole(previous)
      toast.add({
        title: "Não foi possível alterar o papel",
        description: result.error,
        type: "error",
      })
    })
  }

  function onSetActive(active: boolean) {
    startTransition(async () => {
      const result = await setMemberActive(member.membershipId, active)

      if (result.ok) {
        setConfirmOpen(false)
        toast.add({
          title: result.message ?? "Acesso atualizado.",
          type: "success",
        })
        return
      }

      toast.add({
        title: "Não foi possível alterar o acesso",
        description: result.error,
        type: "error",
      })
    })
  }

  return (
    <TableRow>
      <TableCell>
        <div className="flex min-w-56 items-center gap-3">
          <Avatar>
            <AvatarImage src={member.avatarUrl ?? undefined} alt="" />
            <AvatarFallback>{getInitials(displayName)}</AvatarFallback>
          </Avatar>
          <div className="flex min-w-0 flex-col">
            <span className="flex items-center gap-2 font-medium">
              <span className="truncate">{displayName}</span>
              {member.isCurrentUser ? <Badge variant="outline">Você</Badge> : null}
            </span>
            {member.email ? (
              <span className="truncate text-muted-foreground">{member.email}</span>
            ) : null}
          </div>
        </div>
      </TableCell>
      <TableCell>
        {canManage ? (
          <Select items={roleItems} value={role} onValueChange={onRoleChange} disabled={isPending}>
            <SelectTrigger size="sm" className="min-w-36" aria-label={`Papel de ${displayName}`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {roleItems.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        ) : (
          <Badge variant="secondary">{APP_ROLE_LABELS[member.role]}</Badge>
        )}
      </TableCell>
      <TableCell>
        {member.creciNumber ? (
          <div className="flex flex-col items-start gap-1">
            <span>
              {member.creciNumber}
              {member.creciState ? `/${member.creciState}` : ""}
            </span>
            <span className="text-muted-foreground">
              Validade: {formatDateOnly(member.creciValidUntil)}
            </span>
            <CreciStatusBadge validUntil={member.creciValidUntil} today={today} />
          </div>
        ) : (
          <span className="text-muted-foreground">Não informado</span>
        )}
      </TableCell>
      <TableCell>
        {member.active ? (
          <Badge variant="secondary">Ativo</Badge>
        ) : (
          <Badge variant="outline">Inativo</Badge>
        )}
      </TableCell>
      <TableCell className="text-end">
        {!canManage ? null : member.active ? (
          <AlertDialog
            open={confirmOpen}
            onOpenChange={(open) => {
              if (!isPending) setConfirmOpen(open)
            }}
          >
            <AlertDialogTrigger render={<Button variant="ghost" size="sm" disabled={isPending} />}>
              <UserXIcon data-icon="inline-start" />
              Desativar
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Desativar o acesso de {displayName}?</AlertDialogTitle>
                <AlertDialogDescription>
                  A pessoa deixa de acessar esta imobiliária na hora. Imóveis, clientes e histórico
                  ligados a ela continuam salvos, e você pode reativar depois.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel disabled={isPending}>Cancelar</AlertDialogCancel>
                <AlertDialogAction
                  variant="destructive"
                  disabled={isPending}
                  onClick={() => onSetActive(false)}
                >
                  {isPending ? <Spinner data-icon="inline-start" /> : null}
                  Desativar acesso
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        ) : (
          <Button variant="ghost" size="sm" disabled={isPending} onClick={() => onSetActive(true)}>
            {isPending ? (
              <Spinner data-icon="inline-start" />
            ) : (
              <UserCheckIcon data-icon="inline-start" />
            )}
            Reativar
          </Button>
        )}
      </TableCell>
    </TableRow>
  )
}

import { CircleAlertIcon } from "lucide-react"

import type { PlatformTeamMember, PlatformTeamOwner } from "@workspace/core/platform/staff"
import { Badge } from "@workspace/ui/components/badge"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"

import { MemberActions } from "@/components/plataforma/equipe/member-actions"
import { PlatformRoleBadge } from "@/components/plataforma/equipe/platform-role-badge"
import { formatDate, formatDateTime } from "@/lib/format"

type TeamMembersCardProps = {
  owners: PlatformTeamOwner[]
  members: PlatformTeamMember[]
  /** E-mail de quem está vendo (marca "você"). */
  currentEmail: string
  /** Só o Dono vê as ações. */
  canManage: boolean
}

/** Donos (da configuração do servidor, sem ações) e pessoas convidadas. */
export function TeamMembersCard({
  owners,
  members,
  currentEmail,
  canManage,
}: TeamMembersCardProps) {
  const total = owners.length + members.length

  return (
    <Card>
      <CardHeader>
        <CardTitle>Pessoas com acesso</CardTitle>
        <CardDescription>
          {total === 1 ? "1 pessoa" : `${total} pessoas`} no Console da Plataforma. Remover ou mudar
          o papel vale no próximo clique da pessoa.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="flex flex-col divide-y">
          {owners.map((owner) => (
            <li
              key={`dono-${owner.email}`}
              className="flex min-w-0 flex-col gap-1 py-3 first:pt-0 last:pb-0"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="min-w-0 text-sm font-medium break-all">{owner.email}</span>
                {owner.email === currentEmail ? <Badge variant="outline">Você</Badge> : null}
                <PlatformRoleBadge role="owner" />
              </div>
              <p className="text-xs text-muted-foreground">
                Dono (definido na configuração do servidor)
                {owner.hasAccount ? "" : " · ainda sem conta confirmada com este e-mail"}
              </p>
            </li>
          ))}

          {members.map((member) => (
            <li
              key={member.userId}
              className="flex min-w-0 flex-col gap-3 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-start sm:justify-between sm:gap-4"
            >
              <div className="flex min-w-0 flex-col gap-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="min-w-0 text-sm font-medium break-all">{member.email}</span>
                  {member.email === currentEmail ? <Badge variant="outline">Você</Badge> : null}
                  <PlatformRoleBadge role={member.role} />
                </div>
                <p className="text-xs text-muted-foreground">
                  Desde {formatDate(member.joinedAt)}
                  {member.invitedByEmail ? ` · convidado por ${member.invitedByEmail}` : ""}
                  {member.roleChangedAt
                    ? ` · papel alterado em ${formatDateTime(member.roleChangedAt)}`
                    : ""}
                </p>
                {!member.accountEmailMatches ? (
                  <p className="flex items-start gap-1.5 text-xs text-destructive">
                    <CircleAlertIcon aria-hidden="true" className="mt-px size-3.5 shrink-0" />
                    Sem acesso: o e-mail da conta mudou ou não está confirmado. Remova e convide o
                    e-mail novo.
                  </p>
                ) : null}
                {member.isOwnerEmail ? (
                  <p className="text-xs text-muted-foreground">
                    Este e-mail também é Dono pela configuração do servidor, que vale mais. Pode
                    remover desta lista sem perder o acesso.
                  </p>
                ) : null}
              </div>
              {canManage ? (
                <MemberActions userId={member.userId} email={member.email} role={member.role} />
              ) : null}
            </li>
          ))}
        </ul>
        {members.length === 0 ? (
          <p className="mt-3 border-t pt-3 text-sm text-muted-foreground">
            Ninguém convidado ainda.
            {canManage ? " Use Convidar pessoa para dar acesso a alguém da equipe." : ""}
          </p>
        ) : null}
      </CardContent>
    </Card>
  )
}

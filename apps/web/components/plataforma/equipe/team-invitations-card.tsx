import type { PlatformTeamInvitation, PlatformTeamLimits } from "@workspace/core/platform/staff"
import { Badge } from "@workspace/ui/components/badge"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"

import { InvitationActions } from "@/components/plataforma/equipe/invitation-actions"
import { PlatformRoleBadge } from "@/components/plataforma/equipe/platform-role-badge"
import { formatDateTime } from "@/lib/format"

type TeamInvitationsCardProps = {
  invitations: PlatformTeamInvitation[]
  limits: PlatformTeamLimits
  /** Só o Dono vê as ações. */
  canManage: boolean
}

/** Convites abertos (pendentes e expirados sem revogar). */
export function TeamInvitationsCard({ invitations, limits, canManage }: TeamInvitationsCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Convites pendentes</CardTitle>
        <CardDescription>
          {limits.pending} de {limits.maxPending} convites pendentes · {limits.sendsLast24h} de{" "}
          {limits.maxSendsPerDay} envios nas últimas 24 horas. Reenviar gera um link novo e o
          anterior para de valer.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {invitations.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhum convite pendente.</p>
        ) : (
          <ul className="flex flex-col divide-y">
            {invitations.map((invitation) => (
              <li
                key={invitation.id}
                className="flex min-w-0 flex-col gap-3 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-start sm:justify-between sm:gap-4"
              >
                <div className="flex min-w-0 flex-col gap-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="min-w-0 text-sm font-medium break-all">
                      {invitation.email}
                    </span>
                    <PlatformRoleBadge role={invitation.role} />
                    {invitation.expired ? <Badge variant="destructive">Expirado</Badge> : null}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {invitation.expired ? "Expirou em" : "Vale até"}{" "}
                    {formatDateTime(invitation.expiresAt)} · enviado{" "}
                    {invitation.sendCount === 1 ? "1 vez" : `${invitation.sendCount} vezes`} (último
                    em {formatDateTime(invitation.lastSentAt)})
                    {invitation.invitedByEmail ? ` · por ${invitation.invitedByEmail}` : ""}
                  </p>
                </div>
                {canManage ? (
                  <InvitationActions invitationId={invitation.id} email={invitation.email} />
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}

import type { Metadata } from "next"
import { InfoIcon } from "lucide-react"

import {
  PLATFORM_ROLE_DESCRIPTIONS,
  PLATFORM_ROLE_LABELS,
  PLATFORM_ROLES,
  PLATFORM_TEAM_OWNER_ONLY_MESSAGE,
  type PlatformTeamLimits,
} from "@workspace/core/platform/staff"
import { Alert, AlertDescription, AlertTitle } from "@workspace/ui/components/alert"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"

import { PageHeading } from "@/components/crm/page-placeholder"
import { InviteMemberDialog } from "@/components/plataforma/equipe/invite-member-dialog"
import { PlatformRoleBadge } from "@/components/plataforma/equipe/platform-role-badge"
import { TeamInvitationsCard } from "@/components/plataforma/equipe/team-invitations-card"
import { TeamMembersCard } from "@/components/plataforma/equipe/team-members-card"
import { PlatformRpcFailureAlert } from "@/components/plataforma/platform-rpc-failure-alert"
import { canManageTeam, requirePlatformAdmin } from "@/lib/plataforma/admin"
import { listPlatformTeam } from "@/lib/plataforma/equipe"

export const metadata: Metadata = {
  title: "Equipe",
}

function inviteBlockedReason(limits: PlatformTeamLimits): string | null {
  if (limits.sendsLast24h >= limits.maxSendsPerDay) {
    return `Limite de ${limits.maxSendsPerDay} envios de convite em 24 horas atingido. Tente de novo mais tarde.`
  }

  if (limits.pending >= limits.maxPending) {
    return `Já há ${limits.maxPending} convites pendentes. Revogue algum para convidar mais alguém.`
  }

  return null
}

/**
 * Equipe do Console da Plataforma: quem tem acesso, com qual papel, e os
 * convites pendentes. Todos da equipe veem; só o Dono (PLATFORM_ADMIN_EMAILS)
 * convida, reenvia, revoga, muda o papel e remove — os botões só aparecem para
 * ele, e as Server Actions e as RPCs conferem de novo.
 */
export default async function PlatformTeamPage() {
  const admin = await requirePlatformAdmin()
  const isOwner = canManageTeam(admin)
  const result = await listPlatformTeam()

  return (
    <div className="flex flex-1 flex-col gap-6 p-4 lg:p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <PageHeading
          title="Equipe"
          description="Quem acessa o Console da Plataforma e o que cada um pode fazer. Entradas, mudanças de papel e remoções ficam no registro do console e são avisadas por e-mail aos Donos."
        />
        {isOwner && result.ok ? (
          <InviteMemberDialog blockedReason={inviteBlockedReason(result.data.limits)} />
        ) : null}
      </div>

      {!isOwner ? (
        <Alert>
          <InfoIcon />
          <AlertTitle>Você pode ver a equipe</AlertTitle>
          <AlertDescription>
            {PLATFORM_TEAM_OWNER_ONLY_MESSAGE} Seu papel:{" "}
            {PLATFORM_ROLE_LABELS[admin.role].toLowerCase()}.
          </AlertDescription>
        </Alert>
      ) : null}

      {!result.ok ? <PlatformRpcFailureAlert failure={result} /> : null}

      {result.ok ? (
        <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
          <div className="flex min-w-0 flex-col gap-6">
            <TeamMembersCard
              owners={result.data.owners}
              members={result.data.members}
              currentEmail={admin.email}
              canManage={isOwner}
            />
            <TeamInvitationsCard
              invitations={result.data.invitations}
              limits={result.data.limits}
              canManage={isOwner}
            />
          </div>

          <Card size="sm">
            <CardHeader>
              <CardTitle>Papéis</CardTitle>
              <CardDescription>O que cada papel pode fazer no console.</CardDescription>
            </CardHeader>
            <CardContent>
              <dl className="flex flex-col gap-4">
                {PLATFORM_ROLES.map((role) => (
                  <div key={role} className="flex flex-col gap-1">
                    <dt>
                      <PlatformRoleBadge role={role} />
                    </dt>
                    <dd className="text-sm text-muted-foreground">
                      {PLATFORM_ROLE_DESCRIPTIONS[role]}
                    </dd>
                  </div>
                ))}
              </dl>
            </CardContent>
          </Card>
        </div>
      ) : null}
    </div>
  )
}

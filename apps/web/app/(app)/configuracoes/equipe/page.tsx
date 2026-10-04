import type { Metadata } from "next"
import { CircleAlertIcon, MailWarningIcon } from "lucide-react"

import type { AppRole } from "@workspace/core/properties/enums"
import { Alert, AlertDescription, AlertTitle } from "@workspace/ui/components/alert"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"

import { InviteMemberDialog } from "@/components/configuracoes/invite-member-dialog"
import { RolePermissions } from "@/components/configuracoes/role-permissions"
import {
  PendingInvitations,
  type PendingInvitation,
} from "@/components/configuracoes/pending-invitations"
import { TeamMembersTable, type TeamMember } from "@/components/configuracoes/team-members-table"
import { PageHeading } from "@/components/crm/page-placeholder"
import { PageShell } from "@/components/shared/page-shell"
import { TEAM_MANAGER_ROLES } from "@/lib/auth/roles"
import { requireRole } from "@/lib/auth/session"
import { todayInSaoPaulo } from "@/lib/configuracoes/dates"
import { getExportRoles } from "@/lib/configuracoes/export-audit"
import { INVITATION_VALIDITY_DAYS, isInvitationExpired } from "@/lib/configuracoes/invitations"
import { getAssignableRoles } from "@/lib/configuracoes/roles"
import { createClient } from "@/lib/supabase/server"
import { buildInvitationUrl } from "@/lib/tenant/urls"

export const metadata: Metadata = {
  title: "Equipe",
}

export default async function EquipePage() {
  const { user, membership } = await requireRole(TEAM_MANAGER_ROLES)
  const organizationId = membership.organizationId
  const organizationName = membership.organization.name
  const actorRole: AppRole = membership.role
  const supabase = await createClient()

  const [membershipsResult, invitationsResult, exportRoles] = await Promise.all([
    supabase
      .from("memberships")
      .select("id, user_id, role, active")
      .eq("organization_id", organizationId),
    // Só dono e gerente leem convites (RLS), e esta página já exige um dos dois.
    supabase
      .from("invitations")
      .select("id, email, role, token, expires_at")
      .eq("organization_id", organizationId)
      .is("accepted_at", null)
      .order("created_at", { ascending: false }),
    // A matriz de papéis mostra quem exporta de verdade nesta imobiliária.
    getExportRoles(organizationId),
  ])

  if (membershipsResult.error) {
    throw new Error(
      `Não foi possível carregar a equipe (${membershipsResult.error.code ?? "erro"}).`
    )
  }

  const memberships = membershipsResult.data ?? []

  // memberships.user_id aponta para auth.users (sem FK para profiles): busca separada.
  const { data: profiles, error: profilesError } = await supabase
    .from("profiles")
    .select("id, full_name, email, avatar_url, creci_number, creci_state, creci_valid_until")
    .in(
      "id",
      memberships.map((item) => item.user_id)
    )

  if (profilesError) {
    throw new Error(
      `Não foi possível carregar os perfis da equipe (${profilesError.code ?? "erro"}).`
    )
  }

  const profileById = new Map((profiles ?? []).map((profile) => [profile.id, profile]))

  const members: TeamMember[] = memberships
    .map((item) => {
      const profile = profileById.get(item.user_id)

      return {
        membershipId: item.id,
        name: profile?.full_name ?? null,
        email: profile?.email ?? null,
        avatarUrl: profile?.avatar_url ?? null,
        role: item.role,
        active: item.active,
        creciNumber: profile?.creci_number ?? null,
        creciState: profile?.creci_state ?? null,
        creciValidUntil: profile?.creci_valid_until ?? null,
        isCurrentUser: item.user_id === user.id,
      }
    })
    .sort(
      (a, b) =>
        Number(b.active) - Number(a.active) ||
        (a.name ?? a.email ?? "").localeCompare(b.name ?? b.email ?? "", "pt-BR")
    )

  const invitations: PendingInvitation[] = (invitationsResult.data ?? []).map((invitation) => ({
    id: invitation.id,
    email: invitation.email,
    role: invitation.role,
    // Link no subdomínio da imobiliária que convida.
    url: buildInvitationUrl(membership.organization.slug, invitation.token),
    expiresAt: invitation.expires_at,
    expired: isInvitationExpired(invitation.expires_at),
  }))

  return (
    <PageShell
      variant="settings"
      width="wide"
      header={
        <PageHeading
          title="Equipe"
          description={`Quem tem acesso à ${organizationName}, com papel e CRECI de cada pessoa.`}
        />
      }
    >
      <Card>
        <CardHeader>
          <CardTitle>Membros</CardTitle>
          <CardDescription>
            {actorRole === "owner"
              ? "Como dono, você altera o papel e o acesso de qualquer pessoa. A imobiliária precisa manter pelo menos um dono ativo."
              : "Como gerente, você altera o papel e o acesso de corretores, captadores e assistentes."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <TeamMembersTable members={members} actorRole={actorRole} today={todayInSaoPaulo()} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>O que cada papel pode fazer</CardTitle>
          <CardDescription>
            Use antes de escolher o papel de alguém. As regras valem no banco de dados: um papel sem
            permissão não consegue a ação nem por link direto.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <RolePermissions actorRole={actorRole} exportRoles={exportRoles} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Convites pendentes</CardTitle>
          <CardDescription>
            Cada convite é um link válido por {INVITATION_VALIDITY_DAYS} dias que só funciona com o
            e-mail convidado.
          </CardDescription>
          <CardAction>
            <InviteMemberDialog
              assignableRoles={[...getAssignableRoles(actorRole)]}
              organizationName={organizationName}
            />
          </CardAction>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <Alert>
            <MailWarningIcon />
            <AlertTitle>O convite também é enviado por e-mail quando configurado</AlertTitle>
            <AlertDescription>
              Se preferir, copie o link do convite e mande pelo WhatsApp ou pelo seu e-mail. A
              pessoa precisa entrar ou criar a conta com o mesmo e-mail convidado.
            </AlertDescription>
          </Alert>
          {invitationsResult.error ? (
            <Alert variant="destructive">
              <CircleAlertIcon />
              <AlertTitle>Não foi possível carregar os convites</AlertTitle>
              <AlertDescription>Recarregue a página em instantes.</AlertDescription>
            </Alert>
          ) : (
            <PendingInvitations
              invitations={invitations}
              actorRole={actorRole}
              organizationName={organizationName}
            />
          )}
        </CardContent>
      </Card>
    </PageShell>
  )
}

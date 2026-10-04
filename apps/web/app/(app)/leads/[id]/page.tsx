import type { Metadata } from "next"
import { notFound } from "next/navigation"

import { LeadDetailView } from "@/components/leads/lead-detail-view"
import { LeadViewLogger } from "@/components/leads/lead-view-logger"
import { PageShell } from "@/components/shared/page-shell"
import { requireMembership } from "@/lib/auth/session"
import { getOrganizationMembers } from "@/lib/clientes/members"
import { createLeadsClient } from "@/lib/leads/db"
import { canSeeLeadTrackingIds } from "@/lib/leads/permissions"
import { getLead, getLeadDetailExtras } from "@/lib/leads/queries"
import { getLeadSlaSettings } from "@/lib/leads/sla"

export const metadata: Metadata = {
  title: "Lead",
}

type LeadPageProps = {
  params: Promise<{ id: string }>
}

export default async function LeadPage({ params }: LeadPageProps) {
  const [{ user, membership }, { id }] = await Promise.all([requireMembership(), params])
  const organizationId = membership.organizationId
  const lead = await getLead(organizationId, id, canSeeLeadTrackingIds(membership.role))

  if (!lead) {
    notFound()
  }

  const now = new Date()
  const supabase = await createLeadsClient()
  const [members, extras, sla] = await Promise.all([
    getOrganizationMembers(organizationId),
    getLeadDetailExtras(supabase, organizationId, lead.id, lead.clientId),
    getLeadSlaSettings(supabase, organizationId),
  ])

  // Duas colunas (campos | atividades) dependem de separar LeadDetail em blocos: fica
  // para o lote do módulo de leads. Por ora, o registro ocupa a largura toda.
  return (
    <PageShell variant="record">
      <LeadViewLogger leadId={lead.id} />
      <LeadDetailView
        lead={lead}
        members={members}
        extras={extras}
        currentUserId={user.id}
        role={membership.role}
        nowMs={now.getTime()}
        sla={sla}
      />
    </PageShell>
  )
}

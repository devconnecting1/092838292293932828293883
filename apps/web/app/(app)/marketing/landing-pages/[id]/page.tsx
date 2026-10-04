import type { Metadata } from "next"
import { notFound } from "next/navigation"

import { LandingEditor } from "@/components/marketing/editor/landing-editor"
import { ROLE_LABELS, isRole } from "@/lib/auth/roles"
import { requireMembership } from "@/lib/auth/session"
import { getBillingOverview } from "@/lib/billing/queries"
import { isUuid } from "@/lib/imoveis/ids"
import { isLandingTemplateKey } from "@/lib/landing/types"
import {
  toLandingBroker,
  toLandingOrganization,
  toLandingPropertySnapshot,
  type LandingMemberOption,
} from "@/lib/marketing/payload"
import { canEditLandingPages } from "@/lib/marketing/permissions"
import {
  getLandingMembers,
  getLandingOrganization,
  getLandingPageRow,
  getLandingPropertiesByIds,
} from "@/lib/marketing/queries"
import {
  contentToValues,
  themeToIdentityValues,
  toPublicationValues,
} from "@/lib/marketing/schemas"
import { createClient } from "@/lib/supabase/server"

type LandingEditorPageProps = {
  params: Promise<{ id: string }>
}

export async function generateMetadata({ params }: LandingEditorPageProps): Promise<Metadata> {
  const { id } = await params
  if (!isUuid(id)) return { title: "Página de captação" }

  const { membership } = await requireMembership()
  const supabase = await createClient()
  const row = await getLandingPageRow(supabase, membership.organizationId, id).catch(() => null)

  return { title: row ? row.name : "Página de captação não encontrada" }
}

export default async function LandingEditorPage({ params }: LandingEditorPageProps) {
  const [{ id }, { membership }] = await Promise.all([params, requireMembership()])

  if (!isUuid(id)) notFound()

  const organizationId = membership.organizationId
  const supabase = await createClient()
  const row = await getLandingPageRow(supabase, organizationId, id)

  // Página de outra imobiliária (ou removida) cai aqui: o RLS não devolve a linha.
  if (!row || !isLandingTemplateKey(row.template)) notFound()

  const [organization, members, properties, billing] = await Promise.all([
    getLandingOrganization(supabase, organizationId),
    getLandingMembers(supabase, organizationId),
    getLandingPropertiesByIds(supabase, organizationId, row.property_ids),
    getBillingOverview(organizationId),
  ])

  const memberOptions: LandingMemberOption[] = members.map((member) => ({
    id: member.id,
    name: member.full_name?.trim() || member.email || "Membro sem nome",
    roleLabel: isRole(member.role) ? ROLE_LABELS[member.role] : "Membro",
    broker: toLandingBroker(member),
  }))

  return (
    <LandingEditor
      key={row.id}
      page={{
        id: row.id,
        organizationId,
        template: row.template,
        status: row.status,
        publishedAt: row.published_at,
      }}
      initialValues={{
        identity: themeToIdentityValues(row.theme),
        content: contentToValues(row.content),
        publication: toPublicationValues(row),
      }}
      initialProperties={properties.map((property) => toLandingPropertySnapshot(property))}
      initialPropertyIds={row.property_ids}
      initialLeadAssigneeId={row.lead_assignee_id}
      members={memberOptions}
      organization={toLandingOrganization(organization)}
      organizationSlug={organization.slug}
      canEdit={canEditLandingPages(membership.role)}
      uploadsBlocked={billing?.state === "read_only"}
    />
  )
}

import type { Metadata } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"
import { ArrowLeftIcon, EyeIcon } from "lucide-react"

import { LandingTemplate } from "@/components/landing/landing-template"
import { InertLeadForm } from "@/components/marketing/inert-lead-form"
import { requireMembership } from "@/lib/auth/session"
import { isUuid } from "@/lib/imoveis/ids"
import { isLandingTemplateKey, parseLandingContent, parseLandingTheme } from "@/lib/landing/types"
import { landingEditorPath } from "@/lib/marketing/constants"
import {
  buildPreviewPayload,
  toLandingBroker,
  toLandingOrganization,
  toLandingPropertySnapshot,
} from "@/lib/marketing/payload"
import {
  getLandingMembers,
  getLandingOrganization,
  getLandingPageRow,
  getLandingPropertiesByIds,
} from "@/lib/marketing/queries"
import { readLandingSeo } from "@/lib/marketing/schemas"
import { createClient } from "@/lib/supabase/server"

export const metadata: Metadata = {
  title: "Pré-visualização",
  robots: { index: false, follow: false },
}

type LandingPreviewPageProps = {
  params: Promise<{ id: string }>
}

/**
 * Pré-visualização em tela cheia do rascunho salvo, só para membros da
 * imobiliária. Fica numa camada fixa sobre a casca do CRM (a rota vive dentro
 * do grupo (app)), com uma barra fina avisando que não é a página publicada.
 */
export default async function LandingPreviewPage({ params }: LandingPreviewPageProps) {
  const [{ id }, { membership }] = await Promise.all([params, requireMembership()])

  if (!isUuid(id)) notFound()

  const organizationId = membership.organizationId
  const supabase = await createClient()
  const row = await getLandingPageRow(supabase, organizationId, id)

  if (!row || !isLandingTemplateKey(row.template)) notFound()

  const [organization, members, properties] = await Promise.all([
    getLandingOrganization(supabase, organizationId),
    getLandingMembers(supabase, organizationId),
    getLandingPropertiesByIds(supabase, organizationId, row.property_ids),
  ])

  const assignee = members.find((member) => member.id === row.lead_assignee_id)

  const payload = buildPreviewPayload({
    draft: {
      id: row.id,
      template: row.template,
      name: row.name,
      slug: row.slug,
      theme: parseLandingTheme(row.theme),
      content: parseLandingContent(row.content),
      tracking: {},
      seo: readLandingSeo(row.seo),
      publishedAt: row.published_at,
    },
    organization: toLandingOrganization(organization),
    properties: properties.map((property) => toLandingPropertySnapshot(property)),
    broker: assignee ? toLandingBroker(assignee) : null,
  })

  return (
    <div className="fixed inset-0 z-50 flex flex-col overflow-y-auto bg-background">
      <div
        role="status"
        className="sticky top-0 z-10 flex min-h-9 shrink-0 items-center justify-between gap-3 bg-foreground px-4 py-1.5 text-xs text-background"
      >
        <span className="flex min-w-0 items-center gap-2">
          <EyeIcon aria-hidden="true" className="size-3.5 shrink-0" />
          <span className="truncate">
            {row.status === "published"
              ? "Pré-visualização do rascunho salvo — a página publicada é atualizada a cada minuto"
              : "Pré-visualização — não publicada"}
          </span>
        </span>
        <Link
          href={landingEditorPath(row.id)}
          className="flex shrink-0 items-center gap-1 underline-offset-4 hover:underline"
        >
          <ArrowLeftIcon aria-hidden="true" className="size-3.5" />
          Voltar ao editor
        </Link>
      </div>
      <div className="flex-1">
        <LandingTemplate mode="preview" payload={payload} leadForm={<InertLeadForm />} />
      </div>
    </div>
  )
}

import type { Metadata } from "next"
import { notFound } from "next/navigation"

import { LandingTemplate } from "@/components/landing/landing-template"
import { LeadForm } from "@/components/leads-publicos/lead-form"
import { LandingTracking } from "@/components/leads-publicos/tracking"
import { buildLandingJsonLd } from "@/lib/landing/json-ld"
import { serializeJsonLd } from "@/lib/leads-publicos/json-ld"
import { buildLeadFormProps } from "@/lib/leads-publicos/lead-form-config"
import {
  buildLandingCanonicalUrl,
  buildLandingMetadata,
  LANDING_NOT_FOUND_METADATA,
} from "@/lib/leads-publicos/metadata"
import { getPublicLandingPage } from "@/lib/leads-publicos/queries"

/**
 * ISR: o HTML fica em cache e é regerado a cada 60 s, para aguentar picos de
 * tráfego pago com resposta rápida. Nada aqui lê cookies, headers ou
 * searchParams (isso tornaria a página dinâmica): o token antirrobô é pedido
 * pelo formulário ao montar, e UTMs, click ids e consentimento são lidos no
 * navegador.
 */
export const revalidate = 60

type LandingPublicPageProps = {
  params: Promise<{ org: string; page: string }>
}

export async function generateMetadata({ params }: LandingPublicPageProps): Promise<Metadata> {
  const { org, page } = await params
  const landing = await getPublicLandingPage(org, page)

  return landing ? buildLandingMetadata(landing) : LANDING_NOT_FOUND_METADATA
}

export default async function LandingPublicPage({ params }: LandingPublicPageProps) {
  const { org, page } = await params
  const landing = await getPublicLandingPage(org, page)

  if (!landing) {
    notFound()
  }

  const { payload, orgSlug, pageSlug } = landing
  const jsonLdItems = buildLandingJsonLd(payload, {
    pageUrl: buildLandingCanonicalUrl(orgSlug, pageSlug),
  })
  const jsonLd = jsonLdItems.length > 0 ? serializeJsonLd(jsonLdItems) : null
  const formProps = buildLeadFormProps(payload, orgSlug, pageSlug)

  return (
    <>
      {jsonLd ? (
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd }} />
      ) : null}
      {/* Sem o contêiner do GTM (código livre na origem do CRM): ver LandingTracking. */}
      <LandingTracking
        metaPixelId={payload.page.tracking.meta_pixel_id}
        googleTagId={payload.page.tracking.google_tag_id}
        privacyHref={formProps.privacyHref}
      />
      <LandingTemplate
        mode="public"
        payload={payload}
        leadForm={(context) => <LeadForm {...formProps} ctaLabel={context.submitLabel} />}
      />
    </>
  )
}

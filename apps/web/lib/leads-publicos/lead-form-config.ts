import type { LeadFormProps } from "@/components/leads-publicos/lead-form"
import type { LandingProperty, LandingPublicPayload, LandingTemplateKey } from "@/lib/landing/types"
import { LEAD_INTERESTS, type LeadInterest } from "@/lib/leads-publicos/constants"
import { readWhatsappMessageTemplate } from "@/lib/leads-publicos/landing-extras"
import { isUuid } from "@/lib/leads-publicos/schemas"
import { buildLandingPagePath } from "@/lib/tenant/urls"

/** Opções de interesse por modelo. Modelos ausentes mostram todas. */
const TEMPLATE_INTERESTS: Partial<Record<LandingTemplateKey, readonly LeadInterest[]>> = {
  campaign_valuation: ["sell", "info"],
  launch_showcase: ["buy", "invest", "info"],
  launch_waitlist: ["buy", "invest", "info"],
  launch_units: ["buy", "invest", "info"],
}

function propertyLabel(property: LandingProperty) {
  if (property.title) {
    return property.code ? `${property.title} (cód. ${property.code})` : property.title
  }

  return property.code ? `Imóvel ${property.code}` : "Imóvel sem título"
}

function defaultInterestFor(
  template: LandingTemplateKey,
  properties: LandingProperty[],
  interests: readonly LeadInterest[]
): LeadInterest | null {
  let interest: LeadInterest | null = null

  if (template === "campaign_valuation") {
    interest = "sell"
  } else if (properties.length > 0 && properties.every((property) => property.purpose === "rent")) {
    interest = "rent"
  } else if (properties.length > 0 && properties.every((property) => property.purpose === "sale")) {
    interest = "buy"
  }

  return interest && interests.includes(interest) ? interest : null
}

/**
 * Props do LeadForm a partir do payload público. Só imóveis com id UUID entram
 * no seletor (o contrato de submit_landing_lead exige UUID em property_id).
 */
export function buildLeadFormProps(
  payload: LandingPublicPayload,
  orgSlug: string,
  pageSlug: string
): LeadFormProps {
  const { page, organization, properties, broker } = payload
  const interests = TEMPLATE_INTERESTS[page.template] ?? LEAD_INTERESTS

  return {
    orgSlug,
    pageSlug,
    organizationName: organization.name,
    pageLabel: page.content.headline ?? page.name,
    // /lp/{pagina}/privacidade no subdomínio; /lp/{org}/{pagina}/privacidade no host único.
    privacyHref: `${buildLandingPagePath(orgSlug, pageSlug)}/privacidade`,
    ctaLabel: page.content.cta_label ?? null,
    properties: properties
      .filter((property) => isUuid(property.id))
      .map((property) => ({
        id: property.id,
        title: propertyLabel(property),
        code: property.code,
      })),
    typologies: (page.content.launch?.typologies ?? []).map((typology) => typology.name),
    interests,
    defaultInterest: defaultInterestFor(page.template, properties, interests),
    whatsappPhone: page.content.whatsapp_number ?? broker?.phone ?? organization.phone,
    whatsappMessageTemplate: readWhatsappMessageTemplate(payload),
  }
}

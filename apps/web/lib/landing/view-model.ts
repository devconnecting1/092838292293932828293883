/**
 * Payload público → dados prontos para os modelos (textos com fallback, URLs,
 * preços formatados, contatos). Os modelos só leem daqui, sem regra de negócio.
 */
import { getThumbUrl } from "@workspace/core/media/paths"

import {
  brokerCreciLabel,
  cityState,
  fillWhatsappMessage,
  formatDeliveryDate,
  initialsOf,
  isMobilePhoneBr,
  joinPlace,
  organizationCreciLabel,
  phoneDisplay,
  phoneHref,
  propertyDisplayTitle,
  propertyPrices,
  propertyPurposeLabel,
  propertySpecs,
  propertyTypeLabel,
  unitsLeftLabel,
  whatsappHref,
  type PropertyPrice,
  type PropertySpec,
} from "@/lib/landing/format"
import { getLandingTemplate, type LandingTemplateDefinition } from "@/lib/landing/templates"
import {
  buildPublicStorageUrl,
  getStorageBaseUrl,
  resolveLandingTheme,
  type ResolvedLandingTheme,
} from "@/lib/landing/theme"
import {
  LANDING_PROPERTY_MEDIA_BUCKET,
  type LandingProperty,
  type LandingPublicPayload,
  type LandingSocialProofStat,
  type LandingTemplateKey,
  type LandingTestimonial,
  type LandingTypology,
} from "@/lib/landing/types"

export type LandingPropertyView = {
  id: string
  code: string | null
  title: string
  typeLabel: string
  purposeLabel: string | null
  place: string | null
  prices: PropertyPrice[]
  condoFee: number | null
  specs: PropertySpec[]
  features: string[]
  coverUrl: string | null
  /** Miniatura WebP de 400 px da capa (`__thumb.webp`), para cards. Pode não existir em fotos antigas. */
  coverThumbUrl: string | null
  /** Capa primeiro, sem repetição. */
  mediaUrls: string[]
}

export type LandingCopy = {
  headline: string
  subheadline: string
  ctaLabel: string
  formTitle: string
  formDescription: string
}

export type LandingLaunchView = {
  name: string | null
  developer: string | null
  deliveryLabel: string | null
  neighborhood: string | null
  /** "Cambuí, Campinas/SP" */
  place: string | null
  typologies: LandingTypology[]
}

export type LandingOrganizationView = {
  name: string
  initials: string
  place: string | null
  creciLabel: string | null
  logoUrl: string | null
  email: string | null
  phoneDisplay: string | null
  phoneHref: string | null
}

export type LandingBrokerView = {
  name: string
  initials: string
  creciLabel: string | null
  avatarUrl: string | null
  phoneDisplay: string | null
  phoneHref: string | null
}

export type LandingViewModel = {
  key: LandingTemplateKey
  template: LandingTemplateDefinition
  page: { id: string; slug: string; name: string }
  copy: LandingCopy
  description: string | null
  highlights: string[]
  testimonials: LandingTestimonial[]
  socialProof: LandingSocialProofStat[]
  countdownUntil: string | null
  /** "Restam 12 unidades" (null quando vazio ou 0). */
  unitsLeftLabel: string | null
  financingNote: string | null
  theme: ResolvedLandingTheme
  organization: LandingOrganizationView
  broker: LandingBrokerView | null
  properties: LandingPropertyView[]
  /** Primeiro imóvel (modelo de imóvel único). */
  featured: LandingPropertyView | null
  launch: LandingLaunchView
  whatsappHref: string | null
}

export type BuildLandingViewModelOptions = {
  /** Base do Supabase; padrão `NEXT_PUBLIC_SUPABASE_URL`. `null` desliga as URLs. */
  storageBaseUrl?: string | null
}

function toPropertyView(property: LandingProperty, baseUrl: string | null): LandingPropertyView {
  const mediaUrl = (path: string | null) =>
    buildPublicStorageUrl(baseUrl, LANDING_PROPERTY_MEDIA_BUCKET, path)
  const coverUrl = mediaUrl(property.cover_path) ?? mediaUrl(property.media_paths[0] ?? null)
  const mediaUrls = [coverUrl, ...property.media_paths.map(mediaUrl)].filter(
    (url, index, all): url is string => url !== null && all.indexOf(url) === index
  )

  return {
    id: property.id,
    code: property.code,
    title: propertyDisplayTitle(property),
    typeLabel: propertyTypeLabel(property),
    purposeLabel: propertyPurposeLabel(property),
    place: joinPlace(property.neighborhood, property.city, property.state),
    prices: propertyPrices(property),
    condoFee: property.condo_fee != null && property.condo_fee > 0 ? property.condo_fee : null,
    specs: propertySpecs(property),
    features: property.features,
    coverUrl,
    coverThumbUrl: getThumbUrl(coverUrl),
    mediaUrls,
  }
}

/** Mensagem padrão do WhatsApp quando o cliente não define `whatsapp_message`. */
function defaultWhatsappMessage(
  key: LandingTemplateKey,
  organizationName: string,
  featured: LandingPropertyView | null,
  launchName: string | null
) {
  if (key === "campaign_spotlight" && featured) {
    return `Olá! Tenho interesse no imóvel "${featured.title}"${featured.code ? ` (cód. ${featured.code})` : ""}.`
  }
  if (key === "campaign_valuation") return "Olá! Quero avaliar meu imóvel."
  if (
    launchName &&
    (key === "launch_showcase" || key === "launch_waitlist" || key === "launch_units")
  ) {
    return `Olá! Quero saber mais sobre o lançamento ${launchName}.`
  }
  return `Olá! Vim pela página de ${organizationName} e quero mais informações.`
}

export function buildLandingViewModel(
  payload: LandingPublicPayload,
  options: BuildLandingViewModelOptions = {}
): LandingViewModel {
  const { page, organization } = payload
  const key = page.template
  const template = getLandingTemplate(key)
  const content = page.content
  const baseUrl =
    options.storageBaseUrl === undefined ? getStorageBaseUrl() : options.storageBaseUrl

  const theme = resolveLandingTheme(page.theme, organization.brand, {
    storageBaseUrl: baseUrl,
  })

  const properties =
    template.usesProperties === "none"
      ? []
      : payload.properties
          .slice(0, template.maxProperties)
          .map((property) => toPropertyView(property, baseUrl))
  const featured = properties[0] ?? null

  const launch = content.launch ?? {}
  const launchView: LandingLaunchView = {
    name: launch.name ?? null,
    developer: launch.developer ?? null,
    deliveryLabel: formatDeliveryDate(launch.delivery_date),
    neighborhood: launch.neighborhood ?? null,
    place: joinPlace(launch.neighborhood, launch.city, launch.state),
    typologies: launch.typologies ?? [],
  }

  const broker = payload.broker
    ? {
        name: payload.broker.full_name,
        initials: initialsOf(payload.broker.full_name),
        creciLabel: brokerCreciLabel(payload.broker),
        avatarUrl: payload.broker.avatar_url,
        phoneDisplay: phoneDisplay(payload.broker.phone),
        phoneHref: phoneHref(payload.broker.phone),
      }
    : null

  // WhatsApp: o número da página; na página do corretor, o celular dele como reserva.
  const whatsappNumber =
    content.whatsapp_number ??
    (key === "portfolio_broker" && isMobilePhoneBr(payload.broker?.phone)
      ? (payload.broker?.phone ?? null)
      : null)

  const message = content.whatsapp_message
    ? fillWhatsappMessage(content.whatsapp_message, {
        codigo: featured?.code ?? null,
        pagina: page.name,
      })
    : defaultWhatsappMessage(key, organization.name, featured, launchView.name)

  return {
    key,
    template,
    page: { id: page.id, slug: page.slug, name: page.name },
    copy: {
      headline: content.headline ?? template.defaults.headline,
      subheadline: content.subheadline ?? template.defaults.subheadline,
      ctaLabel: content.cta_label ?? template.defaults.cta_label,
      formTitle: template.defaults.formTitle,
      formDescription: template.defaults.formDescription,
    },
    description: content.description ?? null,
    highlights: content.highlights ?? [],
    testimonials: content.testimonials ?? [],
    socialProof: content.social_proof ?? [],
    countdownUntil: content.countdown_until ?? null,
    unitsLeftLabel: unitsLeftLabel(content.units_left),
    financingNote: content.financing_note ?? null,
    theme,
    organization: {
      name: organization.name,
      initials: initialsOf(organization.name),
      place: cityState(organization.city, organization.state),
      creciLabel: organizationCreciLabel(organization.creci, {
        number: organization.owner_creci_number,
        state: organization.owner_creci_state,
      }),
      logoUrl: theme.images.logo,
      email: organization.email,
      phoneDisplay: phoneDisplay(organization.phone),
      phoneHref: phoneHref(organization.phone),
    },
    broker,
    properties,
    featured,
    launch: launchView,
    whatsappHref: whatsappHref(whatsappNumber, message || undefined),
  }
}

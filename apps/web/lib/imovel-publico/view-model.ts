/**
 * Payload público do imóvel → dados prontos para a página (textos, preços,
 * características, fotos, contatos e tema da marca). Puro e isomórfico: a
 * página, os metadados e o JSON-LD leem daqui.
 */
import { buildPhotoSrcSet } from "@workspace/core/media/paths"
import {
  LISTING_PURPOSE_LABELS,
  PROPERTY_USAGE_LABELS,
  requiresLotArea,
} from "@workspace/core/properties/enums"

import { formatCurrency, formatNumber } from "@/lib/format"
import type { PublicProperty, PublicPropertyPayload } from "@/lib/imovel-publico/types"
import {
  cityState,
  initialsOf,
  organizationCreciLabel,
  phoneDisplay,
  phoneHref,
  propertyPrices,
  propertySpecs,
  propertyTypeLabel,
  whatsappHref,
  type PropertyPrice,
  type PropertySpec,
} from "@/lib/landing/format"
import {
  buildPublicStorageUrl,
  getStorageBaseUrl,
  resolveLandingTheme,
  type ResolvedLandingTheme,
} from "@/lib/landing/theme"
import { LANDING_PROPERTY_MEDIA_BUCKET, type LandingProperty } from "@/lib/landing/types"
import type { LeadInterest } from "@/lib/leads-publicos/constants"

export type PublicPropertyPhoto = {
  /** Foto principal (Storage) ou URL externa. */
  src: string
  /** `srcset` com a miniatura (só fotos do Storage). */
  srcSet: string | null
  /** Reserva quando a miniatura não existe (fotos antigas do Storage). */
  fallbackSrc: string | null
  /** Foto hospedada fora (imóvel importado): <img> sem Referer. */
  external: boolean
  alt: string
}

export type PublicPropertyLink = { kind: "video" | "tour"; url: string; label: string }

export type PublicPropertyFact = { label: string; value: string }

export type PublicPropertyView = {
  code: string
  title: string
  typeLabel: string
  /** "à venda", "para alugar", "à venda ou para alugar". */
  purposePhrase: string | null
  purposeLabel: string | null
  /** Endereço conforme o modo de exibição: nunca mais do que o permitido. */
  place: string | null
  prices: PropertyPrice[]
  /** Condomínio e IPTU. */
  costs: PublicPropertyFact[]
  specs: PropertySpec[]
  facts: PublicPropertyFact[]
  features: string[]
  description: string | null
  photos: PublicPropertyPhoto[]
  links: PublicPropertyLink[]
  interests: LeadInterest[]
  defaultInterest: LeadInterest | null
  organization: {
    name: string
    initials: string
    logoUrl: string | null
    creciLabel: string | null
    place: string | null
    email: string | null
    phoneDisplay: string | null
    phoneHref: string | null
  }
  whatsappHref: string | null
  /** "IMV-000123 - Apartamento…" (e-mail de novo lead e consentimento). */
  label: string
  theme: ResolvedLandingTheme
}

const PURPOSE_PHRASES = {
  sale: "à venda",
  rent: "para alugar",
  sale_rent: "à venda ou para alugar",
} as const

/** Formato de LandingProperty para reaproveitar a formatação das landing pages. */
export function toLandingProperty(property: PublicProperty): LandingProperty {
  return {
    id: property.code,
    code: property.code,
    title: property.title,
    purpose: property.purpose,
    type: property.type,
    sale_price: property.salePrice,
    rent_price: property.rentPrice,
    condo_fee: property.condoFee,
    living_area: property.livingArea,
    lot_area: property.lotArea,
    bedrooms: property.bedrooms,
    suites: property.suites,
    bathrooms: property.bathrooms,
    parking_spaces: property.parkingSpaces,
    neighborhood: property.neighborhood,
    city: property.city,
    state: property.state,
    features: property.features,
    cover_path: null,
    media_paths: [],
  }
}

/**
 * Endereço exibido: "neighborhood" → bairro, cidade/UF; "street" → rua, bairro,
 * cidade/UF; "full" → rua, número, bairro, cidade/UF.
 */
export function publicPropertyPlace(property: PublicProperty): string | null {
  const street = property.addressDisplay === "neighborhood" ? null : property.street
  const number = property.addressDisplay === "full" ? property.streetNumber : null
  const streetLine = street ? [street, number].filter(Boolean).join(", ") : null
  const parts = [streetLine, property.neighborhood, cityState(property.city, property.state)]
  const place = parts.filter((part): part is string => Boolean(part && part.trim())).join(", ")

  return place || null
}

function interestsFor(property: PublicProperty): LeadInterest[] {
  switch (property.purpose) {
    case "sale":
      return ["buy"]
    case "rent":
      return ["rent"]
    default:
      return ["buy", "rent"]
  }
}

/** Mensagem pronta do WhatsApp: cita o imóvel e o link (nunca dados do visitante). */
export function publicPropertyWhatsappMessage(
  property: Pick<PublicProperty, "code" | "title">,
  pageUrl: string | null
) {
  const base = `Olá! Tenho interesse no imóvel "${property.title}" (cód. ${property.code}).`
  return pageUrl ? `${base} ${pageUrl}` : base
}

export type BuildPublicPropertyViewOptions = {
  /** URL canônica da página (vai na mensagem do WhatsApp). */
  pageUrl?: string | null
  /** Base do Supabase; padrão NEXT_PUBLIC_SUPABASE_URL. */
  storageBaseUrl?: string | null
}

export function buildPublicPropertyView(
  payload: PublicPropertyPayload,
  options: BuildPublicPropertyViewOptions = {}
): PublicPropertyView {
  const { property, organization } = payload
  const baseUrl =
    options.storageBaseUrl === undefined ? getStorageBaseUrl() : options.storageBaseUrl
  const landing = toLandingProperty(property)
  const typeLabel = propertyTypeLabel(landing)
  const theme = resolveLandingTheme(null, organization.brand, { storageBaseUrl: baseUrl })

  const photos: PublicPropertyPhoto[] = []
  const links: PublicPropertyLink[] = []

  for (const item of payload.media) {
    if (item.kind === "image") {
      const alt = item.caption
        ? `${property.title}: ${item.caption}`
        : `${property.title}, foto ${photos.length + 1}`
      const main = buildPublicStorageUrl(baseUrl, LANDING_PROPERTY_MEDIA_BUCKET, item.storagePath)

      if (main) {
        photos.push({
          src: main,
          srcSet: buildPhotoSrcSet(main) ?? null,
          fallbackSrc: main,
          external: false,
          alt,
        })
      } else if (item.externalUrl) {
        photos.push({ src: item.externalUrl, srcSet: null, fallbackSrc: null, external: true, alt })
      }
    } else if (item.externalUrl && !links.some((link) => link.kind === item.kind)) {
      links.push({
        kind: item.kind,
        url: item.externalUrl,
        label: item.kind === "video" ? "Assistir ao vídeo" : "Fazer o tour virtual",
      })
    }
  }

  const costs: PublicPropertyFact[] = []
  if (property.condoFee != null && property.condoFee > 0) {
    costs.push({ label: "Condomínio", value: `${formatCurrency(property.condoFee)}/mês` })
  }
  if (property.iptuYearly != null && property.iptuYearly > 0) {
    costs.push({ label: "IPTU", value: `${formatCurrency(property.iptuYearly)}/ano` })
  }

  const facts: PublicPropertyFact[] = [{ label: "Tipo", value: typeLabel }]
  if (property.usage) facts.push({ label: "Uso", value: PROPERTY_USAGE_LABELS[property.usage] })
  // A área principal já está nas características; o terreno entra à parte nas casas.
  const lotFirst = property.type ? requiresLotArea(property.type) : false
  if (!lotFirst && property.lotArea && property.livingArea) {
    facts.push({ label: "Área do terreno", value: `${formatNumber(property.lotArea)} m²` })
  }
  if (property.yearBuilt)
    facts.push({ label: "Ano de construção", value: String(property.yearBuilt) })
  if (property.furnished) facts.push({ label: "Mobília", value: "Mobiliado" })
  if (property.acceptsPets) facts.push({ label: "Animais", value: "Aceita pets" })
  facts.push({ label: "Código", value: property.code })

  const interests = interestsFor(property)
  const message = publicPropertyWhatsappMessage(property, options.pageUrl ?? null)

  return {
    code: property.code,
    title: property.title,
    typeLabel,
    purposePhrase: property.purpose ? PURPOSE_PHRASES[property.purpose] : null,
    purposeLabel: property.purpose ? LISTING_PURPOSE_LABELS[property.purpose] : null,
    place: publicPropertyPlace(property),
    prices: propertyPrices(landing),
    costs,
    specs: propertySpecs(landing),
    facts,
    features: property.features,
    description: property.description,
    photos,
    links,
    interests,
    defaultInterest: interests.length === 1 ? (interests[0] ?? null) : null,
    organization: {
      name: organization.name,
      initials: initialsOf(organization.name),
      logoUrl: theme.images.logo,
      creciLabel: organizationCreciLabel(organization.creci, {
        number: organization.owner_creci_number,
        state: organization.owner_creci_state,
      }),
      place: cityState(organization.city, organization.state),
      email: organization.email,
      phoneDisplay: phoneDisplay(organization.phone),
      phoneHref: phoneHref(organization.phone),
    },
    whatsappHref: whatsappHref(organization.phone, message),
    label: `${property.code} - ${property.title}`,
    theme,
  }
}

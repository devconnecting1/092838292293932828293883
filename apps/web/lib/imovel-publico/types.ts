/**
 * Contrato da página pública do imóvel: retorno da RPC `get_public_property`
 * (ver supabase/migrations/*_public_property_page.sql).
 *
 * O parser é TOLERANTE (como o das landing pages): aceita qualquer jsonb,
 * apara e limita textos, valida caminhos do Storage e URLs https e descarta o
 * resto. Nunca lança. Endereço: rua e número só entram quando o modo de
 * exibição do imóvel permite, mesmo que o banco mande (defesa em profundidade).
 *
 * Sem `server-only`: o formulário (cliente) usa os tipos.
 */
import {
  LISTING_PURPOSE_VALUES,
  PROPERTY_TYPE_VALUES,
  PROPERTY_USAGE_VALUES,
  type ListingPurpose,
  type PropertyType,
  type PropertyUsage,
} from "@workspace/core/properties/enums"

import {
  isHttpsUrl,
  isSafeStoragePath,
  LANDING_HEX_COLOR_PATTERN,
  type LandingOrganization,
} from "@/lib/landing/types"
import { safeGoogleTagId, safeMetaPixelId } from "@/lib/leads-publicos/tracking-ids"

export const PUBLIC_PROPERTY_ADDRESS_DISPLAYS = ["full", "street", "neighborhood"] as const

export type PublicPropertyAddressDisplay = (typeof PUBLIC_PROPERTY_ADDRESS_DISPLAYS)[number]

export const PUBLIC_PROPERTY_MEDIA_KINDS = ["image", "video", "tour"] as const

export type PublicPropertyMediaKind = (typeof PUBLIC_PROPERTY_MEDIA_KINDS)[number]

export type PublicPropertyMedia = {
  kind: PublicPropertyMediaKind
  /** Caminho no bucket `property-media` (fotos próprias). */
  storagePath: string | null
  /** URL https na origem (foto importada, vídeo ou tour). */
  externalUrl: string | null
  caption: string | null
  isCover: boolean
}

export type PublicProperty = {
  code: string
  title: string
  description: string | null
  purpose: ListingPurpose | null
  usage: PropertyUsage | null
  type: PropertyType | null
  salePrice: number | null
  rentPrice: number | null
  condoFee: number | null
  iptuYearly: number | null
  livingArea: number | null
  lotArea: number | null
  bedrooms: number | null
  suites: number | null
  bathrooms: number | null
  parkingSpaces: number | null
  yearBuilt: number | null
  features: string[]
  furnished: boolean
  acceptsPets: boolean
  addressDisplay: PublicPropertyAddressDisplay
  /** Só quando `addressDisplay` é "street" ou "full". */
  street: string | null
  /** Só quando `addressDisplay` é "full". */
  streetNumber: string | null
  neighborhood: string | null
  city: string | null
  state: string | null
  /** Data de publicação (ou de cadastro), ISO 8601. */
  listedAt: string | null
  updatedAt: string | null
}

/**
 * Medição da página (Configurações → Imobiliária → Anúncios e página pública).
 * IDs revalidados pelas mesmas regex das landing pages; nunca contêiner GTM.
 */
export type PublicPropertyTracking = {
  metaPixelId: string | null
  googleTagId: string | null
}

export type PublicPropertyPayload = {
  orgSlug: string
  organization: LandingOrganization
  property: PublicProperty
  media: PublicPropertyMedia[]
  tracking: PublicPropertyTracking
}

const LIMITS = {
  title: 200,
  description: 10000,
  features: { items: 40, length: 80 },
  place: 120,
  street: 200,
  streetNumber: 20,
  caption: 200,
  media: 60,
  organizationName: 160,
} as const

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function clip(value: string, max: number) {
  const chars = Array.from(value)
  return chars.length > max ? chars.slice(0, max).join("").trimEnd() : value
}

function text(value: unknown, max: number, multiline = false): string | null {
  if (typeof value !== "string") return null
  const normalized = multiline
    ? value.replace(/\r\n?/g, "\n").replace(/\n{3,}/g, "\n\n")
    : value.replace(/\s+/g, " ")
  const trimmed = normalized.trim()
  return trimmed ? clip(trimmed, max) : null
}

function nonNegative(value: unknown): number | null {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim() !== ""
        ? Number(value)
        : Number.NaN
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null
}

function oneOf<T extends string>(values: readonly T[], value: unknown): T | null {
  return typeof value === "string" && (values as readonly string[]).includes(value)
    ? (value as T)
    : null
}

function stateCode(value: unknown) {
  return typeof value === "string" && /^[a-zA-Z]{2}$/.test(value.trim())
    ? value.trim().toUpperCase()
    : null
}

function isoDate(value: unknown) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}/.test(value.trim())) return null
  return Number.isNaN(new Date(value).getTime()) ? null : value.trim()
}

function parseOrganization(value: unknown): LandingOrganization | null {
  if (!isPlainObject(value)) return null

  const name = text(value.name, LIMITS.organizationName)

  if (!name) return null

  const brand = isPlainObject(value.brand) ? value.brand : {}
  const primaryColor =
    typeof brand.primary_color === "string" && LANDING_HEX_COLOR_PATTERN.test(brand.primary_color)
      ? brand.primary_color.toUpperCase()
      : undefined
  const logoUrl =
    typeof brand.logo_url === "string" && isHttpsUrl(brand.logo_url.trim())
      ? brand.logo_url.trim()
      : undefined

  return {
    name,
    city: text(value.city, 80),
    state: stateCode(value.state),
    phone: text(value.phone, 20),
    email: text(value.email, 160),
    creci: text(value.creci, 40),
    // CRECI F do dono (corretor autônomo sem CRECI J); a RPC só manda nesse caso.
    owner_creci_number: text(value.owner_creci_number, 30),
    owner_creci_state: stateCode(value.owner_creci_state),
    brand: {
      ...(primaryColor ? { primary_color: primaryColor } : {}),
      ...(logoUrl ? { logo_url: logoUrl } : {}),
    },
  }
}

function parseMedia(value: unknown): PublicPropertyMedia | null {
  if (!isPlainObject(value)) return null

  const kind = oneOf(PUBLIC_PROPERTY_MEDIA_KINDS, value.kind)

  if (!kind) return null

  const rawPath = typeof value.storage_path === "string" ? value.storage_path.trim() : null
  const rawUrl = typeof value.external_url === "string" ? value.external_url.trim() : null
  const storagePath = kind === "image" && isSafeStoragePath(rawPath) ? rawPath : null
  const externalUrl = rawUrl && isHttpsUrl(rawUrl) && rawUrl.length <= 2048 ? rawUrl : null

  if (!storagePath && !externalUrl) return null

  return {
    kind,
    storagePath,
    externalUrl: storagePath ? null : externalUrl,
    caption: text(value.caption, LIMITS.caption),
    isCover: value.is_cover === true,
  }
}

function parseProperty(value: unknown): PublicProperty | null {
  if (!isPlainObject(value)) return null

  const code = text(value.code, 40)
  const title = text(value.title, LIMITS.title)

  if (!code || !title) return null

  const addressDisplay =
    oneOf(PUBLIC_PROPERTY_ADDRESS_DISPLAYS, value.address_display) ?? "neighborhood"
  const features = Array.isArray(value.features)
    ? value.features
        .map((feature) => text(feature, LIMITS.features.length))
        .filter((feature): feature is string => feature !== null)
        .slice(0, LIMITS.features.items)
    : []
  const wholeNumber = (raw: unknown) => {
    const parsed = nonNegative(raw)
    return parsed === null ? null : Math.round(parsed)
  }

  return {
    code: code.toUpperCase(),
    title,
    description: text(value.description, LIMITS.description, true),
    purpose: oneOf(LISTING_PURPOSE_VALUES, value.purpose),
    usage: oneOf(PROPERTY_USAGE_VALUES, value.usage),
    type: oneOf(PROPERTY_TYPE_VALUES, value.type),
    salePrice: nonNegative(value.sale_price),
    rentPrice: nonNegative(value.rent_price),
    condoFee: nonNegative(value.condo_fee),
    iptuYearly: nonNegative(value.iptu_yearly),
    livingArea: nonNegative(value.living_area),
    lotArea: nonNegative(value.lot_area),
    bedrooms: wholeNumber(value.bedrooms),
    suites: wholeNumber(value.suites),
    bathrooms: wholeNumber(value.bathrooms),
    parkingSpaces: wholeNumber(value.parking_spaces),
    yearBuilt: wholeNumber(value.year_built),
    features,
    furnished: value.furnished === true,
    acceptsPets: value.accepts_pets === true,
    addressDisplay,
    street: addressDisplay === "neighborhood" ? null : text(value.street, LIMITS.street),
    streetNumber: addressDisplay === "full" ? text(value.street_number, LIMITS.streetNumber) : null,
    neighborhood: text(value.neighborhood, LIMITS.place),
    city: text(value.city, LIMITS.place),
    state: stateCode(value.state),
    listedAt: isoDate(value.listed_at),
    updatedAt: isoDate(value.updated_at),
  }
}

/**
 * Retorno bruto de `get_public_property` → payload seguro, ou `null` quando
 * falta o essencial (imóvel sem código/título ou imobiliária sem nome).
 */
export function parsePublicPropertyPayload(
  value: unknown,
  orgSlug: string
): PublicPropertyPayload | null {
  if (!isPlainObject(value)) return null

  const organization = parseOrganization(value.organization)
  const property = parseProperty(value.property)

  if (!organization || !property) return null

  const media = Array.isArray(value.media)
    ? value.media
        .map(parseMedia)
        .filter((item): item is PublicPropertyMedia => item !== null)
        .slice(0, LIMITS.media)
    : []

  const tracking = isPlainObject(value.tracking) ? value.tracking : {}

  return {
    orgSlug,
    organization,
    property,
    media,
    tracking: {
      metaPixelId: safeMetaPixelId(tracking.meta_pixel_id),
      googleTagId: safeGoogleTagId(tracking.google_tag_id),
    },
  }
}

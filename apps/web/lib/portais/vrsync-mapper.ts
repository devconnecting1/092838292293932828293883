import { z } from "zod"

import {
  formatPhoneBr,
  formatPostalCode,
  isValidPhoneBr,
  isValidPostalCode,
} from "@workspace/core/br/documents"
import {
  buildVrsyncFeed,
  type VrsyncFeedHeader,
  type VrsyncImage,
  type VrsyncListingInput,
  type VrsyncValidationIssue,
} from "@workspace/core/portals/vrsync"
import {
  ADDRESS_DISPLAY_VALUES,
  LISTING_PURPOSE_VALUES,
  MEDIA_KIND_VALUES,
  PROPERTY_TYPE_VALUES,
  PROPERTY_USAGE_VALUES,
  type AddressDisplay,
  type ListingPurpose,
  type MediaKind,
  type PropertyType,
  type PropertyUsage,
} from "@workspace/core/properties/enums"

import { buildPublicMediaUrl } from "./feed-url"

/**
 * Converte o JSON da RPC get_portal_feed nas estruturas de @workspace/core
 * e monta o XML VRSync. Funções puras: a origem das fotos e o nome do
 * provedor chegam por parâmetro.
 *
 * Um imóvel com dados inesperados vira um item "pulado" com explicação; ele
 * nunca derruba o feed inteiro.
 */

function oneOf<T extends string>(values: readonly T[]) {
  return z.custom<T>(
    (value) => typeof value === "string" && (values as readonly string[]).includes(value)
  )
}

const text = z.string().nullish()
const numeric = z.number().nullish()

const mediaSchema = z.object({
  kind: oneOf<MediaKind>(MEDIA_KIND_VALUES),
  storage_path: text,
  external_url: text,
  is_cover: z.boolean().nullish(),
  caption: text,
  position: numeric,
})

const propertySchema = z.object({
  id: z.string(),
  code: z.string(),
  title: text,
  description: text,
  purpose: oneOf<ListingPurpose>(LISTING_PURPOSE_VALUES),
  usage: oneOf<PropertyUsage>(PROPERTY_USAGE_VALUES),
  type: oneOf<PropertyType>(PROPERTY_TYPE_VALUES),
  sale_price: numeric,
  rent_price: numeric,
  condo_fee: numeric,
  iptu_yearly: numeric,
  living_area: numeric,
  lot_area: numeric,
  bedrooms: numeric,
  bathrooms: numeric,
  suites: numeric,
  parking_spaces: numeric,
  features: z.array(z.string()).nullish(),
  postal_code: text,
  street: text,
  street_number: text,
  complement: text,
  neighborhood: text,
  city: text,
  state: text,
  latitude: numeric,
  longitude: numeric,
  address_display: oneOf<AddressDisplay>(ADDRESS_DISPLAY_VALUES),
  media: z.array(z.unknown()).nullish(),
})

const organizationSchema = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  legal_name: text,
  creci: text,
  email: text,
  phone: text,
  city: text,
  state: text,
})

const feedSchema = z.object({
  generated_at: text,
  organization: organizationSchema,
  properties: z.array(z.unknown()),
})

export type PortalFeedOrganization = z.infer<typeof organizationSchema>
export type PortalFeedProperty = z.infer<typeof propertySchema>
export type PortalFeedMedia = z.infer<typeof mediaSchema>

export type ParsedPortalFeed = {
  generatedAt: Date | null
  organization: PortalFeedOrganization
  properties: PortalFeedProperty[]
  /** Itens de `properties` que não seguem o formato esperado. */
  malformed: { id: string | null; code: string | null; title: string | null }[]
}

function readLooseString(value: unknown, key: string) {
  if (value && typeof value === "object" && key in value) {
    const field = (value as Record<string, unknown>)[key]
    return typeof field === "string" ? field : null
  }

  return null
}

/** Valida o JSON da RPC. `null` quando o feed não existe ou o formato é outro. */
export function parsePortalFeed(payload: unknown): ParsedPortalFeed | null {
  const parsed = feedSchema.safeParse(payload)

  if (!parsed.success) {
    return null
  }

  const properties: PortalFeedProperty[] = []
  const malformed: ParsedPortalFeed["malformed"] = []

  for (const item of parsed.data.properties) {
    const property = propertySchema.safeParse(item)

    if (property.success) {
      properties.push(property.data)
    } else {
      malformed.push({
        id: readLooseString(item, "id"),
        code: readLooseString(item, "code"),
        title: readLooseString(item, "title"),
      })
    }
  }

  const generatedAt = parsed.data.generated_at ? new Date(parsed.data.generated_at) : null

  return {
    generatedAt: generatedAt && !Number.isNaN(generatedAt.getTime()) ? generatedAt : null,
    organization: parsed.data.organization,
    properties,
    malformed,
  }
}

function orUndefined<T>(value: T | null | undefined): T | undefined {
  return value ?? undefined
}

function trimmedOrUndefined(value: string | null | undefined) {
  const trimmed = value?.trim()
  return trimmed ? trimmed : undefined
}

function readMedia(items: unknown[] | null | undefined): PortalFeedMedia[] {
  const media: PortalFeedMedia[] = []

  for (const item of items ?? []) {
    const parsed = mediaSchema.safeParse(item)
    if (parsed.success) media.push(parsed.data)
  }

  // A RPC já ordena por position; a ordenação estável aqui só garante o contrato.
  return media
    .map((item, index) => ({ item, index }))
    .sort((a, b) => (a.item.position ?? 0) - (b.item.position ?? 0) || a.index - b.index)
    .map(({ item }) => item)
}

function resolveMediaUrl(media: PortalFeedMedia, supabaseUrl: string) {
  const storagePath = trimmedOrUndefined(media.storage_path)

  if (storagePath) {
    return buildPublicMediaUrl(supabaseUrl, storagePath)
  }

  return trimmedOrUndefined(media.external_url)
}

export type MapListingOptions = {
  /** NEXT_PUBLIC_SUPABASE_URL, base das URLs públicas das fotos. */
  supabaseUrl: string
}

export function mapPropertyToVrsyncListing(
  property: PortalFeedProperty,
  { supabaseUrl }: MapListingOptions
): VrsyncListingInput {
  const media = readMedia(property.media)
  const images: VrsyncImage[] = []
  let videoUrl: string | undefined
  let tourUrl: string | undefined

  for (const item of media) {
    const url = resolveMediaUrl(item, supabaseUrl)

    if (!url) continue

    if (item.kind === "image") {
      images.push({
        url,
        caption: trimmedOrUndefined(item.caption),
        isCover: item.is_cover ?? false,
      })
    } else if (item.kind === "video") {
      videoUrl ??= url
    } else if (item.kind === "tour") {
      tourUrl ??= url
    }
  }

  const rawPostalCode = property.postal_code?.trim() ?? ""

  return {
    code: property.code,
    title: property.title?.trim() ?? "",
    description: property.description?.trim() ?? "",
    purpose: property.purpose,
    usage: property.usage,
    type: property.type,
    prices: {
      salePrice: orUndefined(property.sale_price),
      rentPrice: orUndefined(property.rent_price),
    },
    condoFee: orUndefined(property.condo_fee),
    iptuYearly: orUndefined(property.iptu_yearly),
    livingArea: orUndefined(property.living_area),
    lotArea: orUndefined(property.lot_area),
    bedrooms: orUndefined(property.bedrooms),
    bathrooms: orUndefined(property.bathrooms),
    suites: orUndefined(property.suites),
    parkingSpaces: orUndefined(property.parking_spaces),
    features: property.features?.filter((feature) => feature.trim().length > 0),
    address: {
      country: "BR",
      state: property.state?.trim().toUpperCase() ?? "",
      city: property.city?.trim() ?? "",
      neighborhood: property.neighborhood?.trim() ?? "",
      street: trimmedOrUndefined(property.street),
      number: trimmedOrUndefined(property.street_number),
      complement: trimmedOrUndefined(property.complement),
      postalCode: isValidPostalCode(rawPostalCode)
        ? formatPostalCode(rawPostalCode)
        : rawPostalCode,
      latitude: orUndefined(property.latitude),
      longitude: orUndefined(property.longitude),
      display: property.address_display,
    },
    images,
    videoUrl,
    tourUrl,
    // Ainda não há página pública do imóvel (site da imobiliária: Entrega 2).
    detailUrl: undefined,
  }
}

export function formatOrganizationPhone(phone: string | null | undefined) {
  const value = phone?.trim() ?? ""
  return isValidPhoneBr(value) ? formatPhoneBr(value) : value
}

export type HeaderOptions = {
  /** Nome do sistema que gera o feed. */
  provider: string
  publishDate: Date
}

export function buildVrsyncHeader(
  organization: Pick<PortalFeedOrganization, "name" | "email" | "phone">,
  { provider, publishDate }: HeaderOptions
): VrsyncFeedHeader {
  return {
    provider,
    email: organization.email?.trim() ?? "",
    contactName: organization.name.trim(),
    telephone: formatOrganizationPhone(organization.phone),
    publishDate,
  }
}

/** Dados da imobiliária que o cabeçalho do feed precisa e estão faltando. */
export function getFeedHeaderIssues(
  organization: Pick<PortalFeedOrganization, "email" | "phone">
): string[] {
  const issues: string[] = []

  if (!organization.email?.trim()) {
    issues.push(
      "Informe o e-mail da imobiliária: ele vai no cabeçalho e no contato de cada anúncio."
    )
  }

  if (!organization.phone?.trim()) {
    issues.push("Informe o telefone da imobiliária: ele vai no cabeçalho do feed.")
  }

  return issues
}

export type PortalFeedListingSummary = {
  id: string | null
  code: string
  title: string | null
}

export type PortalFeedSkippedListing = PortalFeedListingSummary & {
  issues: VrsyncValidationIssue[]
}

export type PortalFeedResult = {
  xml: string
  organization: PortalFeedOrganization
  /** Imóveis ativos e marcados para publicação que a RPC devolveu. */
  total: number
  included: PortalFeedListingSummary[]
  skipped: PortalFeedSkippedListing[]
  headerIssues: string[]
}

export type BuildPortalFeedOptions = MapListingOptions & {
  provider: string
  /** Data de publicação quando a RPC não informar generated_at. */
  now?: Date
}

const MALFORMED_ISSUE: VrsyncValidationIssue = {
  field: "dados",
  message:
    "Os dados deste imóvel vieram num formato inesperado. Abra o cadastro, confira os campos e salve de novo.",
  severity: "error",
}

/** JSON da RPC get_portal_feed → XML VRSync + resumo do que entrou e do que ficou de fora. */
export function buildPortalFeed(
  payload: unknown,
  options: BuildPortalFeedOptions
): PortalFeedResult | null {
  const feed = parsePortalFeed(payload)

  if (!feed) {
    return null
  }

  const listings = feed.properties.map((property) => mapPropertyToVrsyncListing(property, options))
  const header = buildVrsyncHeader(feed.organization, {
    provider: options.provider,
    publishDate: feed.generatedAt ?? options.now ?? new Date(),
  })
  const result = buildVrsyncFeed(header, listings)

  const byCode = new Map(feed.properties.map((property) => [property.code, property]))
  const summarize = (code: string): PortalFeedListingSummary => {
    const property = byCode.get(code)
    return { id: property?.id ?? null, code, title: property?.title ?? null }
  }

  return {
    xml: result.xml,
    organization: feed.organization,
    total: feed.properties.length + feed.malformed.length,
    included: result.included.map(summarize),
    skipped: [
      ...result.skipped.map((item) => ({
        ...summarize(item.code),
        issues: item.issues,
      })),
      ...feed.malformed.map((item) => ({
        id: item.id,
        code: item.code ?? "—",
        title: item.title,
        issues: [MALFORMED_ISSUE],
      })),
    ],
    headerIssues: getFeedHeaderIssues(feed.organization),
  }
}

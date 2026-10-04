/**
 * Contrato de dados do módulo de Landing Pages.
 *
 * Espelha as colunas jsonb `landing_pages.theme` e `landing_pages.content` e o
 * retorno da RPC pública da landing page. Os parsers abaixo são TOLERANTES:
 * aceitam qualquer jsonb (inclusive chaves desconhecidas, tipos errados ou
 * lixo) e devolvem valores seguros — textos aparados e com limite, cores e
 * caminhos validados, listas filtradas. Nunca lançam exceção.
 *
 * Sem `server-only`: o editor (cliente) e a rota pública (servidor) usam.
 */
import { z } from "zod"

import {
  LISTING_PURPOSE_VALUES,
  PROPERTY_TYPE_VALUES,
  type ListingPurpose,
  type PropertyType,
} from "@workspace/core/properties/enums"

// ---------------------------------------------------------------------------
// Modelos e buckets
// ---------------------------------------------------------------------------

export const LANDING_TEMPLATE_KEYS = [
  "campaign_spotlight",
  "campaign_offer",
  "campaign_valuation",
  "launch_showcase",
  "launch_waitlist",
  "launch_units",
  "portfolio_grid",
  "portfolio_agency",
  "portfolio_broker",
] as const

export type LandingTemplateKey = (typeof LANDING_TEMPLATE_KEYS)[number]

/** Modelo usado quando o banco traz uma chave desconhecida (funciona com qualquer dado). */
export const DEFAULT_LANDING_TEMPLATE: LandingTemplateKey = "portfolio_grid"

export function isLandingTemplateKey(value: unknown): value is LandingTemplateKey {
  return typeof value === "string" && (LANDING_TEMPLATE_KEYS as readonly string[]).includes(value)
}

export const LANDING_TEMPLATE_CATEGORIES = ["campanhas", "lancamentos", "portfolio"] as const

export type LandingTemplateCategory = (typeof LANDING_TEMPLATE_CATEGORIES)[number]

/** Bucket público das imagens da landing: `{organization_id}/landing/{page_id}/{arquivo}`. */
export const LANDING_ASSETS_BUCKET = "landing-assets"

/** Bucket público das fotos de imóveis (o mesmo de lib/imoveis/constants). */
export const LANDING_PROPERTY_MEDIA_BUCKET = "property-media"

export const LANDING_HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/

// ---------------------------------------------------------------------------
// Limites (teto do parser; o editor pode ser mais restrito por modelo)
// ---------------------------------------------------------------------------

export const LANDING_CONTENT_LIMITS = {
  headline: 120,
  subheadline: 240,
  cta_label: 40,
  description: 2000,
  highlights: { items: 8, length: 120 },
  testimonials: { items: 8, name: 80, text: 500 },
  whatsapp_number: { minDigits: 10, maxDigits: 13 },
  whatsapp_message: 300,
  social_proof: { items: 4, label: 60, value: 16 },
  units_left: { max: 100000 },
  financing_note: 160,
  launch: {
    name: 80,
    developer: 80,
    delivery_date: 40,
    neighborhood: 80,
    city: 80,
    state: 2,
    typologies: { items: 12, name: 60 },
  },
} as const

export const LANDING_THEME_LIMITS = {
  banners: 8,
  path: 512,
} as const

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

/** jsonb `landing_pages.theme`. Caminhos relativos ao bucket `landing-assets`. */
export type LandingTheme = {
  primary_color?: string
  secondary_color?: string
  accent_color?: string
  background_image_path?: string | null
  banner_image_paths?: string[]
  logo_path?: string | null
}

export type LandingTypology = {
  name: string
  area_min?: number
  area_max?: number
  bedrooms?: number
  price_from?: number
}

export type LandingTestimonial = {
  name: string
  text: string
}

export type LandingLaunch = {
  name?: string
  developer?: string
  /** Texto livre ("Dezembro de 2027") ou ISO ("2027-12" / "2027-12-01"). */
  delivery_date?: string
  neighborhood?: string
  city?: string
  state?: string
  typologies?: LandingTypology[]
}

/** jsonb `landing_pages.content`. */
export type LandingContent = {
  headline?: string
  subheadline?: string
  cta_label?: string
  description?: string
  highlights?: string[]
  /** Somente dígitos, com DDD (10–13 dígitos, com ou sem 55). */
  whatsapp_number?: string
  /** Data/hora ISO 8601. */
  countdown_until?: string
  launch?: LandingLaunch
  testimonials?: LandingTestimonial[]
  /**
   * Mensagem pré-preenchida do WhatsApp. Aceita `{codigo}` (código do imóvel
   * em destaque) e `{pagina}` (nome da página).
   */
  whatsapp_message?: string
  /** Números de prova social ("Imóveis vendidos na região" / "+120"), até 4. */
  social_proof?: LandingSocialProofStat[]
  /** Unidades disponíveis (escassez em lançamentos). Inteiro ≥ 0; 0 não é exibido. */
  units_left?: number
  /** Condições de financiamento em uma frase. */
  financing_note?: string
}

export type LandingSocialProofStat = {
  stat_label: string
  stat_value: string
}

export type LandingTracking = {
  /** 5 a 20 dígitos (validado: seguro para injetar no script do Pixel). */
  meta_pixel_id?: string
  /** G-XXXX, GT-XXXX ou AW-XXXX (validado, maiúsculas). */
  google_tag_id?: string
  /** GTM-XXXX (validado, maiúsculas). */
  gtm_container_id?: string
}

export type LandingSeo = {
  title?: string
  description?: string
  /** Caminho no bucket `landing-assets`. */
  og_image_path?: string
}

export type LandingPage = {
  id: string
  template: LandingTemplateKey
  slug: string
  name: string
  theme: LandingTheme
  content: LandingContent
  tracking: LandingTracking
  seo: LandingSeo
  published_at: string | null
}

export type LandingOrganizationBrand = {
  primary_color?: string
  /** Somente https. */
  logo_url?: string
}

export type LandingOrganization = {
  name: string
  city: string | null
  state: string | null
  phone: string | null
  email: string | null
  /** CRECI J da imobiliária (organizations.creci). */
  creci: string | null
  /**
   * CRECI F do dono, só quando não há CRECI J (corretor autônomo). Vem das RPCs
   * públicas; a pré-visualização do CRM não preenche. Nenhum outro dado do perfil.
   */
  owner_creci_number?: string | null
  owner_creci_state?: string | null
  brand: LandingOrganizationBrand
}

export type LandingProperty = {
  id: string
  code: string | null
  title: string | null
  purpose: ListingPurpose | null
  type: PropertyType | null
  sale_price: number | null
  rent_price: number | null
  condo_fee: number | null
  living_area: number | null
  lot_area: number | null
  bedrooms: number | null
  suites: number | null
  bathrooms: number | null
  parking_spaces: number | null
  neighborhood: string | null
  city: string | null
  state: string | null
  features: string[]
  /** Caminho no bucket `property-media`. */
  cover_path: string | null
  /** Caminhos no bucket `property-media`. */
  media_paths: string[]
}

export type LandingBroker = {
  full_name: string
  creci_number: string | null
  creci_state: string | null
  /** Somente https. */
  avatar_url: string | null
  phone: string | null
}

/** Retorno da RPC pública (depois de passar por `parseLandingPublicPayload`). */
export type LandingPublicPayload = {
  page: LandingPage
  organization: LandingOrganization
  properties: LandingProperty[]
  broker: LandingBroker | null
}

// ---------------------------------------------------------------------------
// Blocos de parsing tolerante
// ---------------------------------------------------------------------------

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/** Corta por caracteres visíveis (não parte emoji ao meio). */
function clip(value: string, max: number) {
  const chars = Array.from(value)
  return chars.length > max ? chars.slice(0, max).join("").trimEnd() : value
}

function cleanText(value: unknown, max: number, multiline = false): string | undefined {
  if (typeof value !== "string") return undefined
  const normalized = multiline
    ? value.replace(/\r\n?/g, "\n").replace(/\n{3,}/g, "\n\n")
    : value.replace(/\s+/g, " ")
  const trimmed = normalized.trim()
  return trimmed ? clip(trimmed, max) : undefined
}

/** Texto opcional (vazio/ausente/tipo errado → undefined). */
const text = (max: number, multiline = false) =>
  z.unknown().transform((value) => cleanText(value, max, multiline))

/** Texto anulável (vazio/ausente/tipo errado → null). */
const nullableText = (max: number) =>
  z.unknown().transform((value) => cleanText(value, max) ?? null)

function toFiniteNumber(value: unknown): number | undefined {
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : undefined
  }
  return undefined
}

/** Número ≥ 0 opcional (aceita string numérica, como `numeric` do Postgres em JSON). */
const nonNegative = z.unknown().transform((value) => {
  const parsed = toFiniteNumber(value)
  return parsed != null && parsed >= 0 ? parsed : undefined
})

const nullableNonNegative = nonNegative.transform((value) => value ?? null)

const hexColor = z
  .unknown()
  .transform((value) =>
    typeof value === "string" && LANDING_HEX_COLOR_PATTERN.test(value.trim())
      ? value.trim().toUpperCase()
      : undefined
  )

/**
 * Caminho relativo dentro de um bucket. Recusa URL absoluta, `..`, barra
 * inicial, barra invertida e caracteres de controle.
 */
export function isSafeStoragePath(value: unknown): value is string {
  if (typeof value !== "string") return false
  if (value.length === 0 || value.length > LANDING_THEME_LIMITS.path) return false
  if (value.startsWith("/") || value.includes("\\") || value.includes("://")) return false
  // eslint-disable-next-line no-control-regex
  if (/[ -]/.test(value)) return false
  return value.split("/").every((segment) => segment !== "" && segment !== "." && segment !== "..")
}

const storagePath = z.unknown().transform((value) => {
  const trimmed = typeof value === "string" ? value.trim() : value
  return isSafeStoragePath(trimmed) ? trimmed : undefined
})

const nullableStoragePath = storagePath.transform((value) => value ?? null)

export function isHttpsUrl(value: unknown): value is string {
  if (typeof value !== "string") return false
  try {
    return new URL(value).protocol === "https:"
  } catch {
    return false
  }
}

const httpsUrl = z.unknown().transform((value) => {
  const trimmed = typeof value === "string" ? value.trim() : value
  return isHttpsUrl(trimmed) ? trimmed : undefined
})

/** Lista tolerante: descarta itens inválidos, mantém os válidos até `max`. */
function list<T>(item: z.ZodType<T | undefined | null>, max: number) {
  return z.unknown().transform((value): T[] => {
    if (!Array.isArray(value)) return []
    const items: T[] = []
    for (const entry of value) {
      const parsed = item.safeParse(entry)
      if (parsed.success && parsed.data != null) items.push(parsed.data)
      if (items.length >= max) break
    }
    return items
  })
}

/** Objeto tolerante: qualquer não-objeto vira `{}`; chaves desconhecidas são descartadas. */
function looseObject<Shape extends z.ZodRawShape>(shape: Shape) {
  return z.preprocess((value) => (isPlainObject(value) ? value : {}), z.object(shape))
}

function onlyDefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as T
}

// ---------------------------------------------------------------------------
// Theme
// ---------------------------------------------------------------------------

const themeSchema = looseObject({
  primary_color: hexColor,
  secondary_color: hexColor,
  accent_color: hexColor,
  background_image_path: nullableStoragePath,
  banner_image_paths: list(storagePath, LANDING_THEME_LIMITS.banners),
  logo_path: nullableStoragePath,
})

/** jsonb desconhecido → `LandingTheme` seguro (cores `#RRGGBB` maiúsculas, caminhos validados). */
export function parseLandingTheme(value: unknown): LandingTheme {
  const parsed = themeSchema.safeParse(value)
  if (!parsed.success)
    return {
      background_image_path: null,
      banner_image_paths: [],
      logo_path: null,
    }
  return onlyDefined<LandingTheme>(parsed.data)
}

// ---------------------------------------------------------------------------
// Content
// ---------------------------------------------------------------------------

const limits = LANDING_CONTENT_LIMITS

const whatsappNumber = z.unknown().transform((value) => {
  if (typeof value !== "string" && typeof value !== "number") return undefined
  const digits = String(value).replace(/\D/g, "")
  return digits.length >= limits.whatsapp_number.minDigits &&
    digits.length <= limits.whatsapp_number.maxDigits
    ? digits
    : undefined
})

const isoDateTime = z.unknown().transform((value) => {
  if (typeof value !== "string") return undefined
  const trimmed = value.trim()
  // Exige ao menos AAAA-MM-DD para não aceitar datas ambíguas ("10/11").
  if (!/^\d{4}-\d{2}-\d{2}/.test(trimmed)) return undefined
  return Number.isNaN(new Date(trimmed).getTime()) ? undefined : trimmed
})

const stateCode = z
  .unknown()
  .transform((value) =>
    typeof value === "string" && /^[a-zA-Z]{2}$/.test(value.trim())
      ? value.trim().toUpperCase()
      : undefined
  )

const typologySchema = z.unknown().transform((value): LandingTypology | undefined => {
  if (!isPlainObject(value)) return undefined
  const name = cleanText(value.name, limits.launch.typologies.name)
  if (!name) return undefined
  const areaMin = nonNegative.parse(value.area_min)
  const areaMax = nonNegative.parse(value.area_max)
  const bedrooms = nonNegative.parse(value.bedrooms)
  const priceFrom = nonNegative.parse(value.price_from)
  return onlyDefined<LandingTypology>({
    name,
    area_min: areaMin,
    // Área máxima menor que a mínima é descartada (evita "80 a 60 m²").
    area_max: areaMax != null && (areaMin == null || areaMax >= areaMin) ? areaMax : undefined,
    bedrooms: bedrooms != null ? Math.round(bedrooms) : undefined,
    price_from: priceFrom,
  })
})

const testimonialSchema = z.unknown().transform((value): LandingTestimonial | undefined => {
  if (!isPlainObject(value)) return undefined
  const name = cleanText(value.name, limits.testimonials.name)
  const body = cleanText(value.text, limits.testimonials.text, true)
  return name && body ? { name, text: body } : undefined
})

const launchSchema = looseObject({
  name: text(limits.launch.name),
  developer: text(limits.launch.developer),
  delivery_date: text(limits.launch.delivery_date),
  neighborhood: text(limits.launch.neighborhood),
  city: text(limits.launch.city),
  state: stateCode,
  typologies: list(typologySchema, limits.launch.typologies.items),
})

const socialProofSchema = z.unknown().transform((value): LandingSocialProofStat | undefined => {
  if (!isPlainObject(value)) return undefined
  const label = cleanText(value.stat_label, limits.social_proof.label)
  const statValue =
    typeof value.stat_value === "number" && Number.isFinite(value.stat_value)
      ? String(value.stat_value)
      : cleanText(value.stat_value, limits.social_proof.value)
  return label && statValue ? { stat_label: label, stat_value: statValue } : undefined
})

const unitsLeft = z.unknown().transform((value) => {
  const parsed = toFiniteNumber(value)
  return parsed != null && parsed >= 0 && parsed <= limits.units_left.max
    ? Math.floor(parsed)
    : undefined
})

const contentSchema = looseObject({
  headline: text(limits.headline),
  subheadline: text(limits.subheadline),
  cta_label: text(limits.cta_label),
  description: text(limits.description, true),
  highlights: list(text(limits.highlights.length), limits.highlights.items),
  whatsapp_number: whatsappNumber,
  countdown_until: isoDateTime,
  launch: launchSchema,
  testimonials: list(testimonialSchema, limits.testimonials.items),
  whatsapp_message: text(limits.whatsapp_message, true),
  social_proof: list(socialProofSchema, limits.social_proof.items),
  units_left: unitsLeft,
  financing_note: text(limits.financing_note),
})

/**
 * jsonb desconhecido → `LandingContent` seguro. Textos aparados e cortados no
 * teto de `LANDING_CONTENT_LIMITS`; vazios somem; listas sem itens inválidos.
 * Serve também para normalizar o que o editor vai salvar.
 */
export function parseLandingContent(value: unknown): LandingContent {
  const parsed = contentSchema.safeParse(value)
  if (!parsed.success) return {}
  const { launch, highlights, testimonials, social_proof: socialProof, ...rest } = parsed.data
  const cleanLaunch = onlyDefined<LandingLaunch>(launch)
  const hasLaunch = Object.entries(cleanLaunch).some(([key, entry]) =>
    key === "typologies" ? Array.isArray(entry) && entry.length > 0 : entry !== undefined
  )
  return onlyDefined<LandingContent>({
    ...rest,
    highlights: highlights.length > 0 ? highlights : undefined,
    testimonials: testimonials.length > 0 ? testimonials : undefined,
    social_proof: socialProof.length > 0 ? socialProof : undefined,
    launch: hasLaunch ? cleanLaunch : undefined,
  })
}

// ---------------------------------------------------------------------------
// Payload público
// ---------------------------------------------------------------------------

/** Id de tag: aparado, em maiúsculas, até 40 caracteres e no formato exato; senão undefined. */
const tagId = (pattern: RegExp) =>
  z.unknown().transform((value) => {
    if (typeof value !== "string") return undefined
    const normalized = value.trim().toUpperCase()
    return normalized.length <= 40 && pattern.test(normalized) ? normalized : undefined
  })

// Formatos alinhados com a rota pública (L3), que injeta esses ids em scripts.
const trackingSchema = looseObject({
  meta_pixel_id: z.unknown().transform((value) => {
    const raw = typeof value === "number" && Number.isInteger(value) ? String(value) : value
    return typeof raw === "string" && /^[0-9]{5,20}$/.test(raw.trim()) ? raw.trim() : undefined
  }),
  google_tag_id: tagId(/^(G|GT|AW)-[A-Z0-9]+$/),
  gtm_container_id: tagId(/^GTM-[A-Z0-9]+$/),
})

const seoSchema = looseObject({
  title: text(70),
  description: text(200),
  og_image_path: storagePath,
})

const brandSchema = looseObject({
  primary_color: hexColor,
  logo_url: httpsUrl,
})

const organizationSchema = looseObject({
  name: text(160),
  city: nullableText(80),
  state: nullableText(2),
  phone: nullableText(20),
  email: nullableText(160),
  creci: nullableText(40),
  owner_creci_number: nullableText(30),
  owner_creci_state: nullableText(2),
  brand: brandSchema,
})

const listingPurpose = z
  .unknown()
  .transform((value): ListingPurpose | null =>
    typeof value === "string" && (LISTING_PURPOSE_VALUES as readonly string[]).includes(value)
      ? (value as ListingPurpose)
      : null
  )

const propertyType = z
  .unknown()
  .transform((value): PropertyType | null =>
    typeof value === "string" && (PROPERTY_TYPE_VALUES as readonly string[]).includes(value)
      ? (value as PropertyType)
      : null
  )

const identifier = z.unknown().transform((value) => {
  if (typeof value === "number" && Number.isFinite(value)) return String(value)
  return cleanText(value, 80)
})

const propertySchema = z.unknown().transform((value): LandingProperty | undefined => {
  if (!isPlainObject(value)) return undefined
  const id = identifier.parse(value.id)
  if (!id) return undefined
  const parsed = looseObject({
    code: nullableText(40),
    title: nullableText(200),
    purpose: listingPurpose,
    type: propertyType,
    sale_price: nullableNonNegative,
    rent_price: nullableNonNegative,
    condo_fee: nullableNonNegative,
    living_area: nullableNonNegative,
    lot_area: nullableNonNegative,
    bedrooms: nullableNonNegative,
    suites: nullableNonNegative,
    bathrooms: nullableNonNegative,
    parking_spaces: nullableNonNegative,
    neighborhood: nullableText(80),
    city: nullableText(80),
    state: nullableText(2),
    features: list(text(80), 40),
    cover_path: nullableStoragePath,
    media_paths: list(storagePath, 40),
  }).parse(value)
  return { id, ...parsed }
})

const brokerSchema = z.unknown().transform((value): LandingBroker | null => {
  if (!isPlainObject(value)) return null
  const fullName = cleanText(value.full_name, 120)
  if (!fullName) return null
  return {
    full_name: fullName,
    creci_number: cleanText(value.creci_number, 20) ?? null,
    creci_state: stateCode.parse(value.creci_state) ?? null,
    avatar_url: httpsUrl.parse(value.avatar_url) ?? null,
    phone: cleanText(value.phone, 20) ?? null,
  }
})

/**
 * Retorno bruto da RPC pública → `LandingPublicPayload`, ou `null` quando
 * faltam dados essenciais (página sem id/slug ou organização sem nome).
 * Modelo desconhecido cai em `DEFAULT_LANDING_TEMPLATE`.
 */
export function parseLandingPublicPayload(value: unknown): LandingPublicPayload | null {
  if (!isPlainObject(value) || !isPlainObject(value.page) || !isPlainObject(value.organization)) {
    return null
  }

  const rawPage = value.page
  const id = identifier.parse(rawPage.id)
  const slug = cleanText(rawPage.slug, 120)
  const organization = organizationSchema.parse(value.organization)

  if (!id || !slug || !organization.name) return null

  const publishedAt = isoDateTime.parse(rawPage.published_at)

  return {
    page: {
      id,
      template: isLandingTemplateKey(rawPage.template)
        ? rawPage.template
        : DEFAULT_LANDING_TEMPLATE,
      slug,
      name: cleanText(rawPage.name, 160) ?? organization.name,
      theme: parseLandingTheme(rawPage.theme),
      content: parseLandingContent(rawPage.content),
      tracking: onlyDefined<LandingTracking>(trackingSchema.parse(rawPage.tracking)),
      seo: onlyDefined<LandingSeo>(seoSchema.parse(rawPage.seo)),
      published_at: publishedAt ?? null,
    },
    organization: {
      ...organization,
      name: organization.name,
      brand: onlyDefined<LandingOrganizationBrand>(organization.brand),
    },
    properties: list(propertySchema, 60).parse(value.properties),
    broker: brokerSchema.parse(value.broker),
  }
}

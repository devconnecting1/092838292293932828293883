import { computeImobScore, type ImobScoreResult } from "@workspace/core/properties/imob-score"
import {
  validateVrsyncListing,
  type VrsyncListingInput,
  type VrsyncValidationResult,
} from "@workspace/core/portals/vrsync"
import type { Tables } from "@workspace/database/types"

import { getPropertyMediaPublicUrl } from "@/lib/imoveis/media-url"

/**
 * Montagem das entradas de computeImobScore e validateVrsyncListing a partir
 * das linhas do banco. Puro: roda no servidor (valor gravado) e no navegador
 * (prévia no formulário).
 */

const TIME_ZONE = "America/Sao_Paulo"
/** Brasília é sempre UTC-3 (sem horário de verão desde 2019). */
const BRASILIA_UTC_OFFSET = "-03:00"

export type PropertyScoreSource = Pick<
  Tables<"properties">,
  | "purpose"
  | "type"
  | "description"
  | "sale_price"
  | "rent_price"
  | "condo_fee"
  | "iptu_yearly"
  | "living_area"
  | "lot_area"
  | "bedrooms"
  | "bathrooms"
  | "postal_code"
  | "latitude"
  | "longitude"
>

export type PropertyPortalSource = PropertyScoreSource &
  Pick<
    Tables<"properties">,
    | "code"
    | "title"
    | "usage"
    | "suites"
    | "parking_spaces"
    | "features"
    | "street"
    | "street_number"
    | "complement"
    | "neighborhood"
    | "city"
    | "state"
    | "address_display"
  >

export type MediaSource = Pick<
  Tables<"property_media">,
  "id" | "kind" | "storage_path" | "external_url" | "is_cover" | "caption" | "position"
>

export type AuthorizationPeriod = Pick<Tables<"listing_authorizations">, "starts_on" | "ends_on">

function toNumber(value: number | null | undefined) {
  return value == null ? undefined : Number(value)
}

/** Data de hoje (AAAA-MM-DD) no fuso de São Paulo. */
export function todayInSaoPaulo(now: Date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now)
}

export function isAuthorizationActive(authorization: AuthorizationPeriod, today: string) {
  return (
    authorization.starts_on <= today &&
    (authorization.ends_on == null || authorization.ends_on >= today)
  )
}

export function isAuthorizationExpired(authorization: AuthorizationPeriod, today: string) {
  return authorization.ends_on != null && authorization.ends_on < today
}

/**
 * Validade da autorização vigente para a Nota do Anúncio. Sem data final conta como
 * vigente hoje (fim do dia); com várias vigentes, vale a que vence por último.
 */
export function getAuthorizationExpiry(
  authorizations: readonly AuthorizationPeriod[],
  now: Date = new Date()
) {
  const today = todayInSaoPaulo(now)
  const active = authorizations.filter((item) => isAuthorizationActive(item, today))
  if (active.length === 0) return undefined

  const lastDay = active.reduce<string>((latest, item) => {
    const end = item.ends_on ?? today
    return end > latest ? end : latest
  }, today)

  return `${lastDay}T23:59:59${BRASILIA_UTC_OFFSET}`
}

export type MediaSummary = {
  images: MediaSource[]
  photosCount: number
  videoUrl: string | undefined
  tourUrl: string | undefined
}

export function summarizeMedia(media: readonly MediaSource[]): MediaSummary {
  const sorted = [...media].sort((a, b) => a.position - b.position)
  const images = sorted.filter((item) => item.kind === "image" && item.storage_path)

  return {
    images,
    photosCount: images.length,
    videoUrl: sorted.find((item) => item.kind === "video")?.external_url ?? undefined,
    tourUrl: sorted.find((item) => item.kind === "tour")?.external_url ?? undefined,
  }
}

/**
 * Troca vídeo/tour gravados pelos links digitados no formulário (prévia e
 * validação antes de salvar).
 */
export function withExternalMediaUrls(
  media: readonly MediaSource[],
  videoUrl: string | undefined,
  tourUrl: string | undefined
): MediaSource[] {
  const result: MediaSource[] = media.filter((item) => item.kind === "image")
  const video = videoUrl?.trim()
  const tour = tourUrl?.trim()

  if (video) {
    result.push({
      id: "video",
      kind: "video",
      storage_path: null,
      external_url: video,
      is_cover: false,
      caption: null,
      position: 0,
    })
  }
  if (tour) {
    result.push({
      id: "tour",
      kind: "tour",
      storage_path: null,
      external_url: tour,
      is_cover: false,
      caption: null,
      position: 0,
    })
  }

  return result
}

export function computePropertyScore(
  property: PropertyScoreSource,
  media: MediaSummary,
  authorizations: readonly AuthorizationPeriod[],
  now: Date = new Date()
): ImobScoreResult {
  return computeImobScore(
    {
      purpose: property.purpose,
      type: property.type,
      photosCount: media.photosCount,
      description: property.description ?? undefined,
      prices: {
        salePrice: toNumber(property.sale_price),
        rentPrice: toNumber(property.rent_price),
        condoFee: toNumber(property.condo_fee),
        iptuYearly: toNumber(property.iptu_yearly),
      },
      livingArea: toNumber(property.living_area),
      lotArea: toNumber(property.lot_area),
      bedrooms: toNumber(property.bedrooms),
      bathrooms: toNumber(property.bathrooms),
      address: {
        postalCode: property.postal_code ?? undefined,
        latitude: toNumber(property.latitude),
        longitude: toNumber(property.longitude),
      },
      videoUrl: media.videoUrl,
      tourUrl: media.tourUrl,
      saleAuthorizationExpiresAt: getAuthorizationExpiry(authorizations, now),
    },
    now
  )
}

export function buildVrsyncInput(
  property: PropertyPortalSource,
  media: MediaSummary
): VrsyncListingInput {
  return {
    code: property.code,
    title: property.title,
    description: property.description ?? "",
    purpose: property.purpose,
    usage: property.usage,
    type: property.type,
    prices: {
      salePrice: toNumber(property.sale_price),
      rentPrice: toNumber(property.rent_price),
    },
    condoFee: toNumber(property.condo_fee),
    iptuYearly: toNumber(property.iptu_yearly),
    livingArea: toNumber(property.living_area),
    lotArea: toNumber(property.lot_area),
    bedrooms: toNumber(property.bedrooms),
    bathrooms: toNumber(property.bathrooms),
    suites: toNumber(property.suites),
    parkingSpaces: toNumber(property.parking_spaces),
    features: property.features,
    address: {
      country: "BR",
      state: property.state ?? "",
      city: property.city ?? "",
      neighborhood: property.neighborhood ?? "",
      street: property.street ?? undefined,
      number: property.street_number ?? undefined,
      complement: property.complement ?? undefined,
      postalCode: property.postal_code ?? "",
      latitude: toNumber(property.latitude),
      longitude: toNumber(property.longitude),
      display: property.address_display,
    },
    images: media.images.map((image) => ({
      url: getPropertyMediaPublicUrl(image.storage_path) ?? "",
      caption: image.caption ?? undefined,
      isCover: image.is_cover,
    })),
    videoUrl: media.videoUrl,
    tourUrl: media.tourUrl,
  }
}

export type PortalValidation = VrsyncValidationResult & {
  errors: VrsyncValidationResult["issues"]
  warnings: VrsyncValidationResult["issues"]
}

/**
 * Validação VRSync. O aviso de "URL da página de detalhes" é ignorado: o CRM
 * ainda não tem site público. Sem código (imóvel não salvo) o erro de
 * ListingID também é ignorado.
 */
export function validatePropertyForPortals(
  property: PropertyPortalSource,
  media: MediaSummary
): PortalValidation {
  const result = validateVrsyncListing(buildVrsyncInput(property, media))
  const issues = result.issues.filter(
    (issue) => issue.field !== "detailUrl" && !(issue.field === "code" && property.code === "")
  )
  const errors = issues.filter((issue) => issue.severity === "error")

  return {
    valid: errors.length === 0,
    issues,
    errors,
    warnings: issues.filter((issue) => issue.severity === "warning"),
  }
}

export type ScoreBand = "high" | "medium" | "low" | "none"

/** Faixas da Nota do Anúncio usadas nas cores dos badges. */
export function getScoreBand(score: number | null | undefined): ScoreBand {
  if (score == null) return "none"
  if (score >= 80) return "high"
  if (score >= 50) return "medium"
  return "low"
}

export const SCORE_BAND_LABELS: Record<ScoreBand, string> = {
  high: "Ótimo",
  medium: "Regular",
  low: "Fraco",
  none: "Sem nota",
}

/** Preço exibido conforme a finalidade. */
export function getDisplayPrices(
  property: Pick<Tables<"properties">, "purpose" | "sale_price" | "rent_price">
) {
  const prices: { label: string; value: number | null; suffix?: string }[] = []
  if (property.purpose === "sale" || property.purpose === "sale_rent") {
    prices.push({ label: "Venda", value: property.sale_price })
  }
  if (property.purpose === "rent" || property.purpose === "sale_rent") {
    prices.push({
      label: "Locação",
      value: property.rent_price,
      suffix: "/mês",
    })
  }
  return prices
}

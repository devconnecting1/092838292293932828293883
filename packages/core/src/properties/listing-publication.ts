/**
 * Anúncio no ar: regras puras que espelham o banco (migração
 * 20260917135614_listing_publication_rules — private.listing_authorization_lapsed,
 * private.listing_blocked_by_authorization e private.property_public_page_enabled).
 * Mudou aqui, muda lá.
 *
 * - Autorização vencida: o imóvel tem autorização cadastrada e nenhuma vigente
 *   hoje (todas venceram ou a próxima ainda não começou). Com a regra da
 *   imobiliária ligada (padrão), sai do arquivo dos portais, da página pública,
 *   das landing pages e do sitemap; volta sozinho ao registrar a renovação.
 *   Imóvel sem nenhuma autorização cadastrada não é afetado.
 * - Página pública: a chave do imóvel ou, sem escolha, o padrão da imobiliária.
 *   Imóvel restrito ou que não está ativo nunca tem página.
 *
 * Datas são sempre "AAAA-MM-DD" no fuso de São Paulo.
 */

import type { AuthorizationPeriodInput } from "./authorization-alerts"
import type { PropertyStatus } from "./enums"

export type ListingPublicationSettings = {
  /** Tira do ar imóvel com autorização vencida (padrão: ligado). */
  hideWithoutValidAuthorization: boolean
  /** Página pública dos imóveis sem escolha própria (padrão: ligada). */
  publicPagesEnabledByDefault: boolean
  /** ID do Meta Pixel da página pública do imóvel (só dígitos). */
  metaPixelId: string | null
  /** ID da tag do Google (G-, GT- ou AW-) da página pública do imóvel. */
  googleTagId: string | null
}

/** Sem linha no banco valem estes padrões. */
export const DEFAULT_LISTING_PUBLICATION_SETTINGS: ListingPublicationSettings = {
  hideWithoutValidAuthorization: true,
  publicPagesEnabledByDefault: true,
  metaPixelId: null,
  googleTagId: null,
}

/** Mesmas regras do CHECK do banco (a tag do Google é gravada em maiúsculas). */
export const LISTING_META_PIXEL_ID_PATTERN = /^\d{5,20}$/
export const LISTING_GOOGLE_TAG_ID_PATTERN = /^(G|GT|AW)-[A-Z0-9]{1,30}$/

/** Apara e valida o ID do Meta Pixel; vazio vira null, inválido vira `undefined`. */
export function normalizeMetaPixelId(value: string | null | undefined): string | null | undefined {
  const trimmed = (value ?? "").trim()

  if (!trimmed) return null

  return LISTING_META_PIXEL_ID_PATTERN.test(trimmed) ? trimmed : undefined
}

/** Apara, põe em maiúsculas e valida a tag do Google; vazio vira null, inválido vira `undefined`. */
export function normalizeGoogleTagId(value: string | null | undefined): string | null | undefined {
  const normalized = (value ?? "").trim().toUpperCase()

  if (!normalized) return null

  return LISTING_GOOGLE_TAG_ID_PATTERN.test(normalized) ? normalized : undefined
}

/** Tem autorização vigente na data (começou e ainda não acabou). */
export function hasValidAuthorization(
  authorizations: readonly AuthorizationPeriodInput[],
  today: string
): boolean {
  return authorizations.some(
    (item) => item.starts_on <= today && (item.ends_on == null || item.ends_on >= today)
  )
}

/**
 * Autorização cadastrada, mas nenhuma vigente na data (vencida ou ainda não
 * iniciada). Sem autorização cadastrada: false.
 */
export function isAuthorizationLapsed(
  authorizations: readonly AuthorizationPeriodInput[],
  today: string
): boolean {
  return authorizations.length > 0 && !hasValidAuthorization(authorizations, today)
}

/** Chave efetiva da página pública: a do imóvel ou o padrão da imobiliária. */
export function resolvePublicPageEnabled(
  value: boolean | null | undefined,
  publicPagesEnabledByDefault: boolean
): boolean {
  return typeof value === "boolean" ? value : publicPagesEnabledByDefault
}

/** Por que o anúncio não está no ar (a primeira causa que o usuário precisa resolver). */
export type ListingOffAirReason =
  "restricted" | "inactive" | "authorization" | "public_page_disabled" | "not_published"

export type ListingPublicationInput = {
  status: PropertyStatus
  isRestricted: boolean
  publishedToPortals: boolean
  /** properties.public_page_enabled (null = padrão da imobiliária). */
  publicPageEnabled: boolean | null
  authorizations: readonly AuthorizationPeriodInput[]
  settings: ListingPublicationSettings
  today: string
}

export type ListingPublication = {
  /** Autorização cadastrada e nenhuma vigente hoje (independe da regra). */
  authorizationLapsed: boolean
  /** O anúncio saiu do ar por causa da autorização (regra ligada e imóvel ativo). */
  blockedByAuthorization: boolean
  publicPage: {
    /** Chave efetiva (imóvel ou padrão). */
    enabled: boolean
    /** Sem escolha própria: segue o padrão da imobiliária. */
    followsDefault: boolean
    online: boolean
    reason: ListingOffAirReason | null
  }
  portals: {
    online: boolean
    reason: ListingOffAirReason | null
  }
}

/** Situação do anúncio do imóvel: página pública e arquivo dos portais. */
export function evaluateListingPublication(input: ListingPublicationInput): ListingPublication {
  const authorizationLapsed = isAuthorizationLapsed(input.authorizations, input.today)
  const isActive = input.status === "active"
  const blockedByAuthorization =
    isActive &&
    !input.isRestricted &&
    authorizationLapsed &&
    input.settings.hideWithoutValidAuthorization
  const enabled = resolvePublicPageEnabled(
    input.publicPageEnabled,
    input.settings.publicPagesEnabledByDefault
  )

  let publicReason: ListingOffAirReason | null = null
  if (input.isRestricted) publicReason = "restricted"
  else if (!isActive) publicReason = "inactive"
  else if (!enabled) publicReason = "public_page_disabled"
  else if (blockedByAuthorization) publicReason = "authorization"

  let portalsReason: ListingOffAirReason | null = null
  if (input.isRestricted) portalsReason = "restricted"
  else if (!isActive) portalsReason = "inactive"
  else if (!input.publishedToPortals) portalsReason = "not_published"
  else if (blockedByAuthorization) portalsReason = "authorization"

  return {
    authorizationLapsed,
    blockedByAuthorization,
    publicPage: {
      enabled,
      followsDefault: typeof input.publicPageEnabled !== "boolean",
      online: publicReason === null,
      reason: publicReason,
    },
    portals: {
      online: portalsReason === null,
      reason: portalsReason,
    },
  }
}

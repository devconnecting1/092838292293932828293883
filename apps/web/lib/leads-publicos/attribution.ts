// Atribuição do lead: UTMs, identificadores de clique (Google/Meta), referrer e
// URL da landing. As funções puras servem ao servidor (saneamento do que chega
// do navegador) e ao navegador; as de cookie só rodam em efeitos e handlers.
//
// UTMs e click ids ficam em cookies first-party mesmo sem aceite dos cookies de
// medição: servem só para atribuir o próprio lead (legítimo interesse). Os
// scripts de terceiros continuam dependentes do aceite (ver consent.ts).

import {
  ATTRIBUTION_COOKIE_MAX_AGE_SECONDS,
  ATTRIBUTION_COOKIE_NAME,
  CLICK_ID_KEYS,
  CLICK_ID_MAX_LENGTH,
  LANDING_LEAD_ORIGINS,
  LANDING_URL_MAX_LENGTH,
  LEAD_ORIGIN_PARAM,
  REFERRER_MAX_LENGTH,
  URL_CLICK_ID_KEYS,
  UTM_COOKIE_MAX_AGE_SECONDS,
  UTM_COOKIE_NAME,
  UTM_KEYS,
  UTM_MAX_LENGTH,
  type LandingLeadOrigin,
  type LeadClickIds,
  type LeadUtm,
} from "@/lib/leads-publicos/constants"
import { readBrowserCookie, readJsonCookie, writeBrowserCookie } from "@/lib/leads-publicos/cookies"

/** gclid, gbraid, wbraid, fbclid e os cookies _fbc/_fbp só usam estes caracteres. */
const CLICK_ID_PATTERN = /^[A-Za-z0-9._~-]+$/

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/** Remove caracteres de controle (códigos 0 a 31 e 127). */
function stripControlChars(value: string) {
  return Array.from(value)
    .filter((char) => {
      const code = char.codePointAt(0) ?? 0
      return code >= 32 && code !== 127
    })
    .join("")
}

// ---------------------------------------------------------------------------
// Saneamento (servidor e navegador)
// ---------------------------------------------------------------------------

function cleanUtmValue(value: unknown) {
  if (typeof value !== "string") return null

  const cleaned = stripControlChars(value).trim()
  return cleaned ? cleaned.slice(0, UTM_MAX_LENGTH) : null
}

/** Só utm source/medium/campaign/content/term, sem controle e até 150 caracteres. */
export function sanitizeUtm(value: unknown): LeadUtm {
  if (!isRecord(value)) return {}

  const utm: LeadUtm = {}

  for (const key of UTM_KEYS) {
    const cleaned = cleanUtmValue(value[key])

    if (cleaned) {
      utm[key] = cleaned
    }
  }

  return utm
}

export function hasUtm(utm: LeadUtm) {
  return UTM_KEYS.some((key) => Boolean(utm[key]))
}

/** Lê utm_* de uma query string ("?utm_source=..."). */
export function utmFromSearch(search: string): LeadUtm {
  const params = new URLSearchParams(search)
  const raw: Record<string, string | null> = {}

  for (const key of UTM_KEYS) {
    raw[key] = params.get(`utm_${key}`)
  }

  return sanitizeUtm(raw)
}

/** Origem do link ("instagram" ou "whatsapp", sem diferenciar maiúsculas); o resto é null. */
export function sanitizeLeadOrigin(value: unknown): LandingLeadOrigin | null {
  if (typeof value !== "string") return null

  const origin = value.trim().toLowerCase()

  return (LANDING_LEAD_ORIGINS as readonly string[]).includes(origin)
    ? (origin as LandingLeadOrigin)
    : null
}

/** Lê ?origem= de uma query string. */
export function originFromSearch(search: string): LandingLeadOrigin | null {
  return sanitizeLeadOrigin(new URLSearchParams(search).get(LEAD_ORIGIN_PARAM))
}

/** Só as chaves de CLICK_ID_KEYS, até 255 caracteres e com o alfabeto esperado. */
export function sanitizeClickIds(value: unknown): LeadClickIds {
  if (!isRecord(value)) return {}

  const ids: LeadClickIds = {}

  for (const key of CLICK_ID_KEYS) {
    const raw = value[key]

    if (typeof raw !== "string") continue

    const id = raw.trim()

    if (id && id.length <= CLICK_ID_MAX_LENGTH && CLICK_ID_PATTERN.test(id)) {
      ids[key] = id
    }
  }

  return ids
}

export function clickIdsFromSearch(search: string): LeadClickIds {
  const params = new URLSearchParams(search)
  const raw: Record<string, string | null> = {}

  for (const key of URL_CLICK_ID_KEYS) {
    raw[key] = params.get(key)
  }

  return sanitizeClickIds(raw)
}

/** Valor de `_fbc` no formato do Meta: fb.1.<timestamp_ms>.<fbclid>. */
export function buildFbc(fbclid: string, timestampMs: number) {
  return `fb.1.${timestampMs}.${fbclid}`
}

function parseHttpUrl(value: unknown) {
  if (typeof value !== "string") return null

  const trimmed = value.trim()

  if (!trimmed || trimmed.length > 4096) return null

  try {
    const url = new URL(trimmed)
    return url.protocol === "https:" || url.protocol === "http:" ? url : null
  } catch {
    return null
  }
}

/**
 * Referrer só com origem e caminho: a query string de sites de origem pode
 * carregar dados pessoais e não é necessária para a atribuição.
 */
export function sanitizeReferrer(value: unknown): string | null {
  const url = parseHttpUrl(value)
  return url ? `${url.origin}${url.pathname}`.slice(0, REFERRER_MAX_LENGTH) : null
}

/**
 * URL da landing sem dados pessoais: origem, caminho e apenas os utm_* (os
 * click ids vão separados em `click_ids`). Sem hash e sem outros parâmetros.
 */
export function sanitizeLandingUrl(value: unknown): string | null {
  const url = parseHttpUrl(value)

  if (!url) return null

  const base = `${url.origin}${url.pathname}`

  if (base.length > LANDING_URL_MAX_LENGTH) return null

  const params = new URLSearchParams()

  for (const key of UTM_KEYS) {
    const cleaned = cleanUtmValue(url.searchParams.get(`utm_${key}`))

    if (cleaned) {
      params.set(`utm_${key}`, cleaned)
    }
  }

  const query = params.toString()
  const full = query ? `${base}?${query}` : base

  return full.length <= LANDING_URL_MAX_LENGTH ? full : base
}

// ---------------------------------------------------------------------------
// Navegador
// ---------------------------------------------------------------------------

function readStoredClickIds() {
  return sanitizeClickIds(readJsonCookie(ATTRIBUTION_COOKIE_NAME))
}

/** Click ids novos da URL substituem os guardados; fbclid novo gera novo fbc. */
function mergeClickIds(stored: LeadClickIds, fromUrl: LeadClickIds, now: number) {
  const merged: LeadClickIds = { ...stored, ...fromUrl }

  if (fromUrl.fbclid && (fromUrl.fbclid !== stored.fbclid || !stored.fbc)) {
    merged.fbc = buildFbc(fromUrl.fbclid, now)
  }

  // fbp é sempre lido na hora do cookie _fbp do Meta.
  delete merged.fbp

  return sanitizeClickIds(merged)
}

/**
 * Na chegada à landing: UTMs da URL → cookie `lp_utm` (30 min); gclid, gbraid,
 * wbraid e fbclid (com o fbc montado) → cookie `lp_attr` (90 dias). Sem
 * parâmetros na URL, mantém o que já estava guardado.
 */
export function captureAttribution() {
  if (typeof window === "undefined") return

  const { search } = window.location
  const utm = utmFromSearch(search)

  if (hasUtm(utm)) {
    writeBrowserCookie(UTM_COOKIE_NAME, JSON.stringify(utm), UTM_COOKIE_MAX_AGE_SECONDS)
  }

  const fromUrl = clickIdsFromSearch(search)

  if (Object.keys(fromUrl).length > 0) {
    writeBrowserCookie(
      ATTRIBUTION_COOKIE_NAME,
      JSON.stringify(mergeClickIds(readStoredClickIds(), fromUrl, Date.now())),
      ATTRIBUTION_COOKIE_MAX_AGE_SECONDS
    )
  }
}

export type LeadAttribution = {
  utm: LeadUtm
  /** ?origem= do link (bio do Instagram, WhatsApp). */
  origin: LandingLeadOrigin | null
  clickIds: LeadClickIds
  referrer: string | null
  landingUrl: string | null
}

/** Atribuição atual para o envio (URL > cookies; _fbc/_fbp do Meta quando existirem). */
export function readLeadAttribution(): LeadAttribution {
  if (typeof window === "undefined") {
    return { utm: {}, origin: null, clickIds: {}, referrer: null, landingUrl: null }
  }

  const { search, href } = window.location
  const utmFromUrl = utmFromSearch(search)
  const clickIds = mergeClickIds(readStoredClickIds(), clickIdsFromSearch(search), Date.now())
  const metaFbc = readBrowserCookie("_fbc")
  const metaFbp = readBrowserCookie("_fbp")

  return {
    utm: hasUtm(utmFromUrl) ? utmFromUrl : sanitizeUtm(readJsonCookie(UTM_COOKIE_NAME)),
    origin: originFromSearch(search),
    clickIds: sanitizeClickIds({
      ...clickIds,
      ...(metaFbc ? { fbc: metaFbc } : {}),
      ...(metaFbp ? { fbp: metaFbp } : {}),
    }),
    referrer: sanitizeReferrer(document.referrer),
    landingUrl: sanitizeLandingUrl(href),
  }
}

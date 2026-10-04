// Constantes das landing pages públicas (/lp). Sem `server-only`: o formulário
// (client) e a Server Action usam os mesmos valores.

export const LEAD_INTERESTS = ["buy", "rent", "invest", "sell", "info"] as const

export type LeadInterest = (typeof LEAD_INTERESTS)[number]

export const LEAD_INTEREST_LABELS: Record<LeadInterest, string> = {
  buy: "Comprar",
  rent: "Alugar",
  invest: "Investir",
  sell: "Vender",
  info: "Informações",
}

export function isLeadInterest(value: unknown): value is LeadInterest {
  return LEAD_INTERESTS.some((interest) => interest === value)
}

export const UTM_KEYS = ["source", "medium", "campaign", "content", "term"] as const

export type UtmKey = (typeof UTM_KEYS)[number]

export type LeadUtm = Partial<Record<UtmKey, string>>

/** Identificadores de clique enviados em `click_ids`. */
export const CLICK_ID_KEYS = ["gclid", "gbraid", "wbraid", "fbclid", "fbc", "fbp"] as const

export type ClickIdKey = (typeof CLICK_ID_KEYS)[number]

export type LeadClickIds = Partial<Record<ClickIdKey, string>>

/** Os que chegam como parâmetro na URL do anúncio (fbc/fbp vêm de cookies do Meta). */
export const URL_CLICK_ID_KEYS = ["gclid", "gbraid", "wbraid", "fbclid"] as const

/** Limites do contrato de submit_landing_lead. */
export const LEAD_NAME_MAX_LENGTH = 120
export const LEAD_MESSAGE_MAX_LENGTH = 2000
export const LEAD_TYPOLOGY_MAX_LENGTH = 80
export const UTM_MAX_LENGTH = 150

/**
 * Origem marcada pelo link (?origem=instagram, ?origem=whatsapp): o lead entra
 * com essa origem em vez de "Landing page". Lista fechada, validada de novo no
 * banco (submit_landing_lead).
 */
export const LEAD_ORIGIN_PARAM = "origem"
export const LANDING_LEAD_ORIGINS = ["instagram", "whatsapp"] as const
export type LandingLeadOrigin = (typeof LANDING_LEAD_ORIGINS)[number]
export const CLICK_ID_MAX_LENGTH = 255
export const REFERRER_MAX_LENGTH = 500
export const LANDING_URL_MAX_LENGTH = 500

/** Cookies first-party das landing pages (todos com Path=/lp e SameSite=Lax). */
export const LANDING_COOKIE_PATH = "/lp"
export const UTM_COOKIE_NAME = "lp_utm"
export const UTM_COOKIE_MAX_AGE_SECONDS = 30 * 60
export const ATTRIBUTION_COOKIE_NAME = "lp_attr"
export const ATTRIBUTION_COOKIE_MAX_AGE_SECONDS = 90 * 24 * 60 * 60
export const CONSENT_COOKIE_NAME = "lp_consent"
export const CONSENT_COOKIE_MAX_AGE_SECONDS = 180 * 24 * 60 * 60

export const DEFAULT_CTA_LABEL = "Quero atendimento"

/**
 * Espera no navegador quando o token antirrobô acabou de ser emitido no próprio
 * envio. Precisa ser maior que MIN_FILL_MS de lib/captacao/anti-bot.ts (3 s),
 * senão o servidor descarta o envio como robô.
 */
export const FRESH_TOKEN_WAIT_MS = 3500

export const HONEYPOT_FIELD = "website"

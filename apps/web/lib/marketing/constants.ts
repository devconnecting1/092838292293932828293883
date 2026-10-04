/** Constantes do módulo de Marketing (landing pages). */

export const LANDING_PAGES_PATH = "/marketing/landing-pages"
export const NEW_LANDING_PAGE_PATH = `${LANDING_PAGES_PATH}/nova`

export function landingEditorPath(id: string) {
  return `${LANDING_PAGES_PATH}/${id}`
}

export function landingPreviewPath(id: string) {
  return `${LANDING_PAGES_PATH}/${id}/previa`
}

/** Bucket público das imagens das landing pages. */
export const LANDING_ASSETS_BUCKET = "landing-assets"

/** Limite do bucket landing-assets. */
export const LANDING_MAX_IMAGE_BYTES = 5 * 1024 * 1024

export const LANDING_ACCEPTED_IMAGE_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
}

export const LANDING_ACCEPTED_IMAGE_ACCEPT_ATTR = Object.keys(LANDING_ACCEPTED_IMAGE_TYPES).join(
  ","
)

export const LANDING_STATUSES = ["draft", "published", "archived"] as const
export type LandingStatus = (typeof LANDING_STATUSES)[number]

export const LANDING_STATUS_LABELS: Record<LandingStatus, string> = {
  draft: "Rascunho",
  published: "Publicada",
  archived: "Arquivada",
}

/** Nome interno. */
export const LANDING_NAME_MAX_LENGTH = 120

/** Slug: letras minúsculas, números e hífens (3 a 60). */
export const LANDING_SLUG_MIN_LENGTH = 3
export const LANDING_SLUG_MAX_LENGTH = 60
export const LANDING_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/** SEO: limites que cabem no resultado de busca sem corte. */
export const SEO_TITLE_MAX_LENGTH = 70
export const SEO_DESCRIPTION_MAX_LENGTH = 160

/** Meta Pixel: só dígitos. Google Tag: G-, GT- ou AW-. */
export const META_PIXEL_ID_PATTERN = /^\d{6,20}$/
export const GOOGLE_TAG_ID_PATTERN = /^(G|GT|AW)-[A-Z0-9]{4,20}$/
/** Google Tag Manager: GTM-XXXXXXX. */
export const GTM_CONTAINER_ID_PATTERN = /^GTM-[A-Z0-9]+$/
export const GTM_CONTAINER_ID_MAX_LENGTH = 20

/** Quantidade máxima de imóveis nos modelos com vários imóveis. */
export const MAX_LANDING_PROPERTIES = 12

/** Atraso do salvamento automático do editor. */
export const AUTOSAVE_DELAY_MS = 1200

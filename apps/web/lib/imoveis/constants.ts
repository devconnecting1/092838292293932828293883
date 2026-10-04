import { LISTING_PHOTO_MAX_BYTES } from "@workspace/core/billing/plans"
import { Constants } from "@workspace/database/types"

/** Bucket público das fotos (os portais baixam pela URL pública do feed VRSync). */
export const PROPERTY_MEDIA_BUCKET = "property-media"

/** Limite por foto já otimizada: o mesmo do bucket `property-media` (2 MB). */
export const MAX_IMAGE_BYTES = LISTING_PHOTO_MAX_BYTES

export const ACCEPTED_IMAGE_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
}

export const ACCEPTED_IMAGE_ACCEPT_ATTR = Object.keys(ACCEPTED_IMAGE_TYPES).join(",")

export const PROPERTIES_PAGE_SIZE = 20

/** Descrição ideal para a Nota do Anúncio (imob_score): pontuação máxima a partir daqui. */
export const DESCRIPTION_IDEAL_LENGTH = 300
export const DESCRIPTION_MAX_LENGTH = 10000

export const TITLE_MAX_LENGTH = 200
export const CAPTION_MAX_LENGTH = 300

/** Valores dos enums do banco como tuplas (para z.enum e listas de opções). */
export const LISTING_PURPOSES = Constants.public.Enums.listing_purpose
export const PROPERTY_USAGES = Constants.public.Enums.property_usage
export const PROPERTY_TYPES = Constants.public.Enums.property_type
export const PROPERTY_STATUSES = Constants.public.Enums.property_status
export const ADDRESS_DISPLAYS = Constants.public.Enums.address_display

/** Explicação de cada opção de exibição do endereço nos portais. */
export const ADDRESS_DISPLAY_HINTS: Record<(typeof ADDRESS_DISPLAYS)[number], string> = {
  full: "Rua, número e bairro aparecem no anúncio. Use só com autorização do proprietário.",
  street: "Mostra a rua e o bairro, sem o número. O pino do mapa fica aproximado.",
  neighborhood: "Mostra apenas bairro e cidade. Mais privacidade para o proprietário.",
}

const YOUTUBE_URL_PATTERN = /^https:\/\/(www\.|m\.)?(youtube\.com\/|youtu\.be\/)\S+$/i
const HTTPS_URL_PATTERN = /^https:\/\/\S+$/i

export function isYoutubeUrl(value: string) {
  return YOUTUBE_URL_PATTERN.test(value.trim())
}

export function isHttpsUrl(value: string) {
  return HTTPS_URL_PATTERN.test(value.trim())
}

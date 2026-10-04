// Limites de mídia aplicados pelo app (o banco replica os mesmos limites).

const MB = 1024 * 1024

/**
 * Fotos por imóvel próprio. É o `limits.photos_per_listing` dos planos, igual em
 * todos (10); o banco aplica o valor do plano no trigger de property_media.
 */
export const MAX_PROPERTY_PHOTOS = 10

/** Maior arquivo de imagem aceito para otimizar no navegador (antes da compressão). */
export const MAX_SOURCE_IMAGE_BYTES = 40 * MB

/** PDFs de documentos de clientes passam sem alteração, até este tamanho. */
export const CLIENT_DOCUMENT_PDF_MAX_BYTES = 10 * MB

/**
 * Quantos arquivos de um lote cabem no limite de fotos do imóvel.
 * `accepted` + `rejected` = `incoming`.
 */
export function splitByPhotoLimit(
  currentCount: number,
  incoming: number,
  max: number = MAX_PROPERTY_PHOTOS
) {
  const remaining = Math.max(0, max - Math.max(0, currentCount))
  const accepted = Math.min(Math.max(0, incoming), remaining)
  return { remaining, accepted, rejected: Math.max(0, incoming) - accepted }
}

/** Mensagem única quando a assinatura está em modo leitura (RLS recusa uploads). */
export const UPLOADS_BLOCKED_MESSAGE =
  "Sua assinatura está em modo leitura: envie novos arquivos depois de regularizar."

/** Mensagem única quando o imóvel atinge o limite de fotos (checagem prévia e erro do banco). */
export function photoLimitMessage(limit: number) {
  return `Este imóvel já tem ${limit} fotos, o máximo permitido. Remova uma foto para enviar outra.`
}

type StorageErrorLike = {
  message?: string
  statusCode?: string | number
  status?: string | number
} | null

/**
 * 403 do Storage. Com a assinatura em modo leitura o RLS recusa INSERT/UPDATE
 * nos buckets e o erro chega genérico; a UI já esconde o upload de quem não
 * tem permissão, então o 403 é tratado como modo leitura (defesa extra).
 */
export function isStorageForbiddenError(error: StorageErrorLike | undefined) {
  if (!error) return false
  const status = String(error.statusCode ?? error.status ?? "")
  const text = `${error.message ?? ""}`.toLowerCase()
  return status === "403" || text.includes("row-level security")
}

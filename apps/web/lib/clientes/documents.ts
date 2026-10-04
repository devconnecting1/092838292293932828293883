import { CLIENT_DOCUMENT_MIME_TYPES } from "@/lib/clientes/constants"

export type ClientDocumentMimeType = (typeof CLIENT_DOCUMENT_MIME_TYPES)[number]

export function isAllowedDocumentMimeType(value: string): value is ClientDocumentMimeType {
  return (CLIENT_DOCUMENT_MIME_TYPES as readonly string[]).includes(value)
}

/** Nome seguro para a chave do Storage: sem acentos, espaços ou barras. */
export function sanitizeFileName(name: string) {
  const normalized = name.normalize("NFD").replace(/[̀-ͯ]/g, "")
  const lastDot = normalized.lastIndexOf(".")
  const base = lastDot > 0 ? normalized.slice(0, lastDot) : normalized
  const extension = lastDot > 0 ? normalized.slice(lastDot + 1) : ""
  const clean = (value: string) =>
    value
      .replace(/[^A-Za-z0-9_-]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "")

  const safeBase = clean(base).slice(0, 80) || "arquivo"
  const safeExtension = clean(extension).slice(0, 10).toLowerCase()

  return safeExtension ? `${safeBase}.${safeExtension}` : safeBase
}

/** {organization_id}/clients/{client_id}/{uuid}-{nome} — exigido pelas políticas do bucket. */
export function buildClientDocumentPath(
  organizationId: string,
  clientId: string,
  fileName: string,
  uniqueId: string
) {
  return `${organizationId}/clients/${clientId}/${uniqueId}-${sanitizeFileName(fileName)}`
}

const sizeFormat = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 })

export function formatFileSize(bytes: number | null | undefined) {
  if (bytes === null || bytes === undefined) return "—"
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${sizeFormat.format(bytes / 1024)} KB`
  return `${sizeFormat.format(bytes / (1024 * 1024))} MB`
}

export function getDocumentKindLabel(mimeType: string | null | undefined) {
  if (mimeType === "application/pdf") return "PDF"
  if (mimeType?.startsWith("image/")) return "Imagem"
  return "Arquivo"
}

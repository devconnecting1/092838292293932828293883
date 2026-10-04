/**
 * Dossiê do imóvel (tabela property_documents, bucket privado
 * property-documents). Módulo puro: tipos, rótulos, limites, caminho no
 * Storage e validade. O banco replica as mesmas regras nos CHECKs e nas
 * políticas do bucket.
 */

// ---------------------------------------------------------------------------
// Tipos de documento (enum property_document_kind)
// ---------------------------------------------------------------------------

export type PropertyDocumentKind =
  | "registry"
  | "iptu"
  | "floor_plan"
  | "occupancy_permit"
  | "certificate"
  | "listing_agreement"
  | "other"

export const PROPERTY_DOCUMENT_KIND_VALUES: readonly PropertyDocumentKind[] = [
  "registry",
  "iptu",
  "floor_plan",
  "occupancy_permit",
  "certificate",
  "listing_agreement",
  "other",
]

export const PROPERTY_DOCUMENT_KIND_LABELS: Record<PropertyDocumentKind, string> = {
  registry: "Matrícula",
  iptu: "IPTU",
  floor_plan: "Planta",
  occupancy_permit: "Habite-se",
  certificate: "Certidão",
  listing_agreement: "Contrato de autorização",
  other: "Outro documento",
}

/** Parte do nome do arquivo baixado: "matricula-IMV-000123.pdf". */
const PROPERTY_DOCUMENT_KIND_SLUGS: Record<PropertyDocumentKind, string> = {
  registry: "matricula",
  iptu: "iptu",
  floor_plan: "planta",
  occupancy_permit: "habite-se",
  certificate: "certidao",
  listing_agreement: "contrato-de-autorizacao",
  other: "documento",
}

export function isPropertyDocumentKind(value: unknown): value is PropertyDocumentKind {
  return (
    typeof value === "string" &&
    (PROPERTY_DOCUMENT_KIND_VALUES as readonly string[]).includes(value)
  )
}

// ---------------------------------------------------------------------------
// Arquivo: formatos, tamanho e caminho
// ---------------------------------------------------------------------------

export const PROPERTY_DOCUMENTS_BUCKET = "property-documents"

/** Mesmo limite do bucket e do CHECK property_documents_size_bytes. */
export const PROPERTY_DOCUMENT_MAX_BYTES = 10 * 1024 * 1024

export const PROPERTY_DOCUMENT_DESCRIPTION_MAX_LENGTH = 120

export const PROPERTY_DOCUMENT_EXTENSIONS = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
} as const

export type PropertyDocumentMimeType = keyof typeof PROPERTY_DOCUMENT_EXTENSIONS

export const PROPERTY_DOCUMENT_MIME_TYPES = Object.keys(
  PROPERTY_DOCUMENT_EXTENSIONS
) as PropertyDocumentMimeType[]

export function isPropertyDocumentMimeType(value: unknown): value is PropertyDocumentMimeType {
  return typeof value === "string" && Object.hasOwn(PROPERTY_DOCUMENT_EXTENSIONS, value)
}

const UUID_PATTERN = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}"

/**
 * {organization_id}/properties/{property_id}/{uuid}.{extensão}. O nome é
 * aleatório: o arquivo enviado pode se chamar "Matrícula João Silva.pdf", e
 * esse nome nunca vai para o Storage.
 */
export function buildPropertyDocumentPath(
  organizationId: string,
  propertyId: string,
  uniqueId: string,
  mimeType: PropertyDocumentMimeType
): string {
  const id = uniqueId.toLowerCase()

  if (!new RegExp(`^${UUID_PATTERN}$`).test(id)) {
    throw new Error("Identificador do arquivo inválido.")
  }

  return `${organizationId}/properties/${propertyId}/${id}.${PROPERTY_DOCUMENT_EXTENSIONS[mimeType]}`
}

/** Confere o caminho enviado pelo navegador (espelho do CHECK do banco). */
export function isPropertyDocumentPath(
  path: string,
  organizationId: string,
  propertyId: string,
  mimeType: PropertyDocumentMimeType
): boolean {
  const prefix = `${organizationId}/properties/${propertyId}/`

  if (!path.startsWith(prefix)) return false

  const file = path.slice(prefix.length)
  return new RegExp(`^${UUID_PATTERN}\\.${PROPERTY_DOCUMENT_EXTENSIONS[mimeType]}$`).test(file)
}

/** Nome do arquivo no download, sem dado pessoal: "certidao-IMV-000123.pdf". */
export function propertyDocumentFileName(
  kind: PropertyDocumentKind,
  propertyCode: string,
  mimeType: PropertyDocumentMimeType
): string {
  const code = propertyCode.replace(/[^A-Za-z0-9-]+/g, "").slice(0, 40) || "imovel"
  return `${PROPERTY_DOCUMENT_KIND_SLUGS[kind]}-${code}.${PROPERTY_DOCUMENT_EXTENSIONS[mimeType]}`
}

// ---------------------------------------------------------------------------
// Validade
// ---------------------------------------------------------------------------

/** A partir de quantos dias antes do vencimento a ficha avisa. */
export const PROPERTY_DOCUMENT_EXPIRING_DAYS = 30

export type PropertyDocumentValidity =
  | { state: "no_expiry" }
  | { state: "valid"; daysLeft: number }
  | { state: "expiring"; daysLeft: number }
  | { state: "expired"; daysOverdue: number }

function isoDateToDayNumber(value: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return null

  const time = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
  return Number.isNaN(time) ? null : Math.round(time / 86_400_000)
}

/**
 * Situação da validade em datas sem hora (AAAA-MM-DD), com `today` no fuso de
 * São Paulo calculado por quem chama. Vence no fim do dia `validUntil`.
 */
export function getPropertyDocumentValidity(
  validUntil: string | null | undefined,
  today: string,
  expiringDays: number = PROPERTY_DOCUMENT_EXPIRING_DAYS
): PropertyDocumentValidity {
  if (!validUntil) return { state: "no_expiry" }

  const end = isoDateToDayNumber(validUntil)
  const now = isoDateToDayNumber(today)

  if (end === null || now === null) return { state: "no_expiry" }

  const daysLeft = end - now

  if (daysLeft < 0) return { state: "expired", daysOverdue: -daysLeft }
  if (daysLeft <= expiringDays) return { state: "expiring", daysLeft }

  return { state: "valid", daysLeft }
}

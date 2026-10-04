import type { Enums } from "@workspace/database/types"

export const CLIENTS_PATH = "/clientes"
export const CLIENTS_PAGE_SIZE = 20

// -----------------------------------------------------------------------------
// Origem do cliente (clients.source, texto livre até 60 caracteres)
// -----------------------------------------------------------------------------
export const CLIENT_SOURCE_VALUES = [
  "site",
  "landing_page",
  "portal",
  "indicacao",
  "placa",
  "redes_sociais",
  "outro",
] as const

export type ClientSource = (typeof CLIENT_SOURCE_VALUES)[number]

export const CLIENT_SOURCE_LABELS: Record<ClientSource, string> = {
  site: "Site",
  landing_page: "Landing page",
  portal: "Portal",
  indicacao: "Indicação",
  placa: "Placa",
  redes_sociais: "Redes sociais",
  outro: "Outro",
}

export function isClientSource(value: unknown): value is ClientSource {
  return typeof value === "string" && (CLIENT_SOURCE_VALUES as readonly string[]).includes(value)
}

export function getClientSourceLabel(value: string | null | undefined) {
  if (!value) return "—"
  return isClientSource(value) ? CLIENT_SOURCE_LABELS[value] : value
}

// -----------------------------------------------------------------------------
// LGPD: base legal do tratamento (clients.lgpd_legal_basis)
// -----------------------------------------------------------------------------
export const LGPD_LEGAL_BASIS_VALUES = ["consent", "contract", "legitimate_interest"] as const

export type LgpdLegalBasis = (typeof LGPD_LEGAL_BASIS_VALUES)[number]

export const LGPD_LEGAL_BASIS_LABELS: Record<LgpdLegalBasis, string> = {
  consent: "Consentimento",
  contract: "Execução de contrato ou pré-contrato",
  legitimate_interest: "Legítimo interesse",
}

export function isLgpdLegalBasis(value: unknown): value is LgpdLegalBasis {
  return typeof value === "string" && (LGPD_LEGAL_BASIS_VALUES as readonly string[]).includes(value)
}

export function getLgpdLegalBasisLabel(value: string | null | undefined) {
  if (!value) return "Não informada"
  return isLgpdLegalBasis(value) ? LGPD_LEGAL_BASIS_LABELS[value] : value
}

// -----------------------------------------------------------------------------
// Atividades (linha do tempo)
// -----------------------------------------------------------------------------
export type ActivityType = Enums<"activity_type">

export const ACTIVITY_TYPE_LABELS: Record<ActivityType, string> = {
  note: "Nota",
  call: "Ligação",
  email: "E-mail",
  whatsapp: "WhatsApp",
  visit: "Visita",
  meeting: "Reunião",
  status_change: "Mudança de status",
}

/** Tipos que a equipe registra manualmente na ficha. */
export const MANUAL_ACTIVITY_TYPES = [
  "note",
  "call",
  "email",
  "whatsapp",
  "visit",
  "meeting",
] as const satisfies readonly ActivityType[]

export type ManualActivityType = (typeof MANUAL_ACTIVITY_TYPES)[number]

// -----------------------------------------------------------------------------
// Documentos (bucket privado client-documents)
// -----------------------------------------------------------------------------
export const CLIENT_DOCUMENTS_BUCKET = "client-documents"
export const CLIENT_DOCUMENT_MAX_BYTES = 20 * 1024 * 1024
export const CLIENT_DOCUMENT_MIME_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
] as const
/** Validade da URL assinada de download, em segundos. */
export const CLIENT_DOCUMENT_SIGNED_URL_TTL = 60

export const CLIENT_TAG_MAX_LENGTH = 40
export const CLIENT_TAGS_MAX = 20

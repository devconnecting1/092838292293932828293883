/**
 * Enumerações do domínio de imóveis, espelhando os valores persistidos no
 * banco (Postgres/Supabase). Identificadores em inglês; rótulos em pt-BR
 * para exibição.
 */

// ---------------------------------------------------------------------------
// ListingPurpose
// ---------------------------------------------------------------------------

export type ListingPurpose = "sale" | "rent" | "sale_rent"

export const LISTING_PURPOSE_VALUES: readonly ListingPurpose[] = ["sale", "rent", "sale_rent"]

export const LISTING_PURPOSE_LABELS: Record<ListingPurpose, string> = {
  sale: "Venda",
  rent: "Locação",
  sale_rent: "Venda e locação",
}

// ---------------------------------------------------------------------------
// PropertyUsage
// ---------------------------------------------------------------------------

export type PropertyUsage = "residential" | "commercial" | "rural" | "industrial"

export const PROPERTY_USAGE_VALUES: readonly PropertyUsage[] = [
  "residential",
  "commercial",
  "rural",
  "industrial",
]

export const PROPERTY_USAGE_LABELS: Record<PropertyUsage, string> = {
  residential: "Residencial",
  commercial: "Comercial",
  rural: "Rural",
  industrial: "Industrial",
}

// ---------------------------------------------------------------------------
// PropertyType
// ---------------------------------------------------------------------------

export type PropertyType =
  | "apartment"
  | "house"
  | "condo_house"
  | "penthouse"
  | "studio"
  | "flat"
  | "land"
  | "commercial_room"
  | "office"
  | "store"
  | "warehouse"
  | "building"
  | "farm"
  | "ranch"
  | "other"

export const PROPERTY_TYPE_VALUES: readonly PropertyType[] = [
  "apartment",
  "house",
  "condo_house",
  "penthouse",
  "studio",
  "flat",
  "land",
  "commercial_room",
  "office",
  "store",
  "warehouse",
  "building",
  "farm",
  "ranch",
  "other",
]

export const PROPERTY_TYPE_LABELS: Record<PropertyType, string> = {
  apartment: "Apartamento",
  house: "Casa",
  condo_house: "Casa em condomínio",
  penthouse: "Cobertura",
  studio: "Studio/Kitnet",
  flat: "Flat",
  land: "Terreno",
  commercial_room: "Sala comercial",
  office: "Escritório",
  store: "Loja",
  warehouse: "Galpão",
  building: "Prédio",
  farm: "Fazenda",
  ranch: "Sítio/Chácara",
  other: "Outro",
}

/** Tipos cuja área relevante é a área do terreno (lote), não a área construída. */
export function requiresLotArea(type: PropertyType): boolean {
  return type === "land" || type === "farm" || type === "ranch" || type === "warehouse"
}

/** Campos de preço obrigatórios de acordo com a finalidade do anúncio. */
export type RequiredPriceField = "salePrice" | "rentPrice"

export function requiredPrices(purpose: ListingPurpose): RequiredPriceField[] {
  switch (purpose) {
    case "sale":
      return ["salePrice"]
    case "rent":
      return ["rentPrice"]
    case "sale_rent":
      return ["salePrice", "rentPrice"]
  }
}

// ---------------------------------------------------------------------------
// AddressDisplay
// ---------------------------------------------------------------------------

export type AddressDisplay = "full" | "street" | "neighborhood"

export const ADDRESS_DISPLAY_VALUES: readonly AddressDisplay[] = ["full", "street", "neighborhood"]

export const ADDRESS_DISPLAY_LABELS: Record<AddressDisplay, string> = {
  full: "Endereço completo",
  street: "Somente rua",
  neighborhood: "Somente bairro",
}

// ---------------------------------------------------------------------------
// PropertyStatus
// ---------------------------------------------------------------------------

export type PropertyStatus = "draft" | "active" | "reserved" | "sold" | "rented" | "inactive"

export const PROPERTY_STATUS_VALUES: readonly PropertyStatus[] = [
  "draft",
  "active",
  "reserved",
  "sold",
  "rented",
  "inactive",
]

export const PROPERTY_STATUS_LABELS: Record<PropertyStatus, string> = {
  draft: "Rascunho",
  active: "Ativo",
  reserved: "Reservado",
  sold: "Vendido",
  rented: "Alugado",
  inactive: "Inativo",
}

// ---------------------------------------------------------------------------
// MediaKind
// ---------------------------------------------------------------------------

export type MediaKind = "image" | "video" | "tour"

export const MEDIA_KIND_VALUES: readonly MediaKind[] = ["image", "video", "tour"]

export const MEDIA_KIND_LABELS: Record<MediaKind, string> = {
  image: "Foto",
  video: "Vídeo",
  tour: "Tour virtual",
}

// ---------------------------------------------------------------------------
// ClientKind
// ---------------------------------------------------------------------------

export type ClientKind = "pf" | "pj"

export const CLIENT_KIND_VALUES: readonly ClientKind[] = ["pf", "pj"]

export const CLIENT_KIND_LABELS: Record<ClientKind, string> = {
  pf: "Pessoa física",
  pj: "Pessoa jurídica",
}

// ---------------------------------------------------------------------------
// AppRole
// ---------------------------------------------------------------------------

export type AppRole = "owner" | "manager" | "broker" | "capturer" | "assistant" | "finance"

export const APP_ROLE_VALUES: readonly AppRole[] = [
  "owner",
  "manager",
  "broker",
  "capturer",
  "assistant",
  "finance",
]

export const APP_ROLE_LABELS: Record<AppRole, string> = {
  owner: "Dono",
  manager: "Gerente",
  broker: "Corretor",
  capturer: "Captador",
  assistant: "Assistente",
  finance: "Financeiro",
}

// ---------------------------------------------------------------------------
// AppointmentStatus
// ---------------------------------------------------------------------------

export type AppointmentStatus = "scheduled" | "confirmed" | "done" | "no_show" | "canceled"

export const APPOINTMENT_STATUS_VALUES: readonly AppointmentStatus[] = [
  "scheduled",
  "confirmed",
  "done",
  "no_show",
  "canceled",
]

export const APPOINTMENT_STATUS_LABELS: Record<AppointmentStatus, string> = {
  scheduled: "Agendado",
  confirmed: "Confirmado",
  done: "Realizado",
  no_show: "Não compareceu",
  canceled: "Cancelado",
}

// ---------------------------------------------------------------------------
// TaskStatus / TaskPriority
// ---------------------------------------------------------------------------

export type TaskStatus = "open" | "done" | "canceled"

export const TASK_STATUS_VALUES: readonly TaskStatus[] = ["open", "done", "canceled"]

export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  open: "Aberta",
  done: "Concluída",
  canceled: "Cancelada",
}

export type TaskPriority = "low" | "medium" | "high"

export const TASK_PRIORITY_VALUES: readonly TaskPriority[] = ["low", "medium", "high"]

export const TASK_PRIORITY_LABELS: Record<TaskPriority, string> = {
  low: "Baixa",
  medium: "Média",
  high: "Alta",
}

// ---------------------------------------------------------------------------
// ProposalStatus
// ---------------------------------------------------------------------------

export type ProposalStatus = "draft" | "sent" | "countered" | "accepted" | "rejected" | "withdrawn"

export const PROPOSAL_STATUS_VALUES: readonly ProposalStatus[] = [
  "draft",
  "sent",
  "countered",
  "accepted",
  "rejected",
  "withdrawn",
]

export const PROPOSAL_STATUS_LABELS: Record<ProposalStatus, string> = {
  draft: "Rascunho",
  sent: "Enviada",
  countered: "Contraproposta",
  accepted: "Aceita",
  rejected: "Recusada",
  withdrawn: "Retirada",
}

// ---------------------------------------------------------------------------
// KeyStatus
// ---------------------------------------------------------------------------

export type KeyStatus = "available" | "checked_out" | "lost"

export const KEY_STATUS_VALUES: readonly KeyStatus[] = ["available", "checked_out", "lost"]

export const KEY_STATUS_LABELS: Record<KeyStatus, string> = {
  available: "Disponível",
  checked_out: "Retirada",
  lost: "Perdida",
}

// ---------------------------------------------------------------------------
// CaptureStatus
// ---------------------------------------------------------------------------

export type CaptureStatus = "new" | "contacted" | "converted" | "discarded"

export const CAPTURE_STATUS_VALUES: readonly CaptureStatus[] = [
  "new",
  "contacted",
  "converted",
  "discarded",
]

export const CAPTURE_STATUS_LABELS: Record<CaptureStatus, string> = {
  new: "Nova",
  contacted: "Contatado",
  converted: "Convertida",
  discarded: "Descartada",
}

import { LEAD_SLA_DEFAULT_MINUTES } from "@workspace/core/leads/routing"

import type { ClientSource } from "@/lib/clientes/constants"
import type { LeadContactChannel, LeadInterest, LeadSource, LeadStage } from "@/lib/leads/db-types"

export const LEADS_PATH = "/leads"

/** Máximo de leads carregados no quadro (os mais recentes). */
export const LEADS_LIST_LIMIT = 1000

/**
 * Meta de primeiro contato PADRÃO, só para quem ainda não configurou: cada
 * imobiliária define a sua em `lead_routing_settings.sla_minutes` (1..1440) e
 * o valor chega à tela por props (ver `lib/leads/sla.ts`). Nada na interface
 * deve assumir 5 min fixos.
 */
export const LEAD_RESPONSE_TARGET_MINUTES = LEAD_SLA_DEFAULT_MINUTES

/** Limites do prazo e do aviso, iguais aos CHECKs da migração `lead_roulette_sla`. */
export {
  LEAD_SLA_DEFAULT_WARNING_PERCENT,
  LEAD_SLA_MAX_MINUTES,
  LEAD_SLA_MAX_WARNING_PERCENT,
  LEAD_SLA_MIN_MINUTES,
  LEAD_SLA_MIN_WARNING_PERCENT,
} from "@workspace/core/leads/routing"

/** Janela para apontar possível duplicado (mesmo telefone ou e-mail). */
export const LEAD_DUPLICATE_WINDOW_DAYS = 90
/** Registros relacionados guardados por lead. */
export const LEAD_DUPLICATES_MAX = 10

/** Espaçamento padrão entre posições ao renumerar uma coluna. */
export const LEAD_POSITION_STEP = 1024

export const LEAD_LOST_REASON_MAX_LENGTH = 500
export const LEAD_MESSAGE_MAX_LENGTH = 5000
export const LEAD_NAME_MAX_LENGTH = 200

// -----------------------------------------------------------------------------
// Etapas do funil (enum lead_stage)
// -----------------------------------------------------------------------------
export const LEAD_STAGES = [
  "new",
  "contacted",
  "qualified",
  "visit_scheduled",
  "proposal",
  "won",
  "lost",
] as const satisfies readonly LeadStage[]

export const LEAD_STAGE_LABELS: Record<LeadStage, string> = {
  new: "Novo",
  contacted: "Em contato",
  qualified: "Qualificado",
  visit_scheduled: "Visita agendada",
  proposal: "Proposta",
  won: "Ganho",
  lost: "Perdido",
}

/** Colunas que começam recolhidas no quadro (mostram só a contagem). */
export const COLLAPSED_BY_DEFAULT_STAGES: readonly LeadStage[] = ["won", "lost"]

/** Etapas ainda em aberto (ganho e perdido encerram o lead). */
export const OPEN_LEAD_STAGES: readonly LeadStage[] = [
  "new",
  "contacted",
  "qualified",
  "visit_scheduled",
  "proposal",
]

export function isLeadStage(value: unknown): value is LeadStage {
  return typeof value === "string" && (LEAD_STAGES as readonly string[]).includes(value)
}

// -----------------------------------------------------------------------------
// Origem (enum lead_source)
// -----------------------------------------------------------------------------
export const LEAD_SOURCES = [
  "landing_page",
  "portal",
  "website",
  "social",
  "instagram",
  "whatsapp",
  "referral",
  "manual",
  "other",
] as const satisfies readonly LeadSource[]

export const LEAD_SOURCE_LABELS: Record<LeadSource, string> = {
  landing_page: "Landing page",
  portal: "Portal",
  website: "Site",
  social: "Redes sociais",
  instagram: "Instagram",
  whatsapp: "WhatsApp",
  referral: "Indicação",
  manual: "Cadastro manual",
  other: "Outro",
}

/** Origens que a equipe escolhe no cadastro manual (landing page vem só do formulário público). */
export const MANUAL_LEAD_SOURCES = [
  "manual",
  "instagram",
  "whatsapp",
  "portal",
  "website",
  "social",
  "referral",
  "other",
] as const satisfies readonly LeadSource[]

export function isLeadSource(value: unknown): value is LeadSource {
  return typeof value === "string" && (LEAD_SOURCES as readonly string[]).includes(value)
}

/**
 * Origem do cliente criado na conversão, dentro de CLIENT_SOURCE_VALUES do
 * formulário de cliente. O nome da landing page vai para as observações.
 */
export const LEAD_SOURCE_TO_CLIENT_SOURCE: Record<LeadSource, ClientSource> = {
  landing_page: "landing_page",
  website: "site",
  portal: "portal",
  social: "redes_sociais",
  instagram: "redes_sociais",
  whatsapp: "outro",
  referral: "indicacao",
  manual: "outro",
  other: "outro",
}

// -----------------------------------------------------------------------------
// Contato registrado (enum lead_contact_channel)
// -----------------------------------------------------------------------------
export const LEAD_CONTACT_CHANNELS = [
  "call",
  "whatsapp",
  "email",
  "in_person",
] as const satisfies readonly LeadContactChannel[]

export const LEAD_CONTACT_CHANNEL_LABELS: Record<LeadContactChannel, string> = {
  call: "Ligação",
  whatsapp: "WhatsApp",
  email: "E-mail",
  in_person: "Presencial",
}

/** Resposta de "Conseguiu falar?": Sim é contato; Não é só a tentativa. */
export type LeadContactInput = { channel: LeadContactChannel; reached: boolean }

// -----------------------------------------------------------------------------
// Interesse (leads.interest)
// -----------------------------------------------------------------------------
export const LEAD_INTERESTS = [
  "buy",
  "rent",
  "invest",
  "sell",
  "info",
] as const satisfies readonly LeadInterest[]

export const LEAD_INTEREST_LABELS: Record<LeadInterest, string> = {
  buy: "Comprar",
  rent: "Alugar",
  invest: "Investir",
  sell: "Vender",
  info: "Informações",
}

export function isLeadInterest(value: unknown): value is LeadInterest {
  return typeof value === "string" && (LEAD_INTERESTS as readonly string[]).includes(value)
}

export function getLeadInterestLabel(value: string | null | undefined) {
  if (!value) return null
  return isLeadInterest(value) ? LEAD_INTEREST_LABELS[value] : value
}

/** Sugestões rápidas de motivo de perda (o texto continua livre). */
export const LEAD_LOST_REASON_SUGGESTIONS = [
  "Sem resposta após várias tentativas",
  "Comprou/alugou com outra imobiliária",
  "Fora do orçamento",
  "Desistiu da mudança",
  "Contato inválido",
] as const

import type { Enums } from "@workspace/database/types"

import type { LeadContactChannel, LeadRow, LeadSource, LeadStage } from "@/lib/leads/db-types"
import {
  detectAdPlatforms,
  readClickIdsFromUrl,
  readLeadClickIds,
  readLeadUtm,
  stripClickIdParams,
  type LeadAdPlatform,
  type LeadClickIds,
  type LeadUtm,
} from "@/lib/leads/format"

export type LeadPropertyRef = { id: string; code: string; title: string }

export type LeadLandingPageRef = {
  id: string
  name: string
  slug: string
  template: string
}

/** Outro lead ou cliente com o mesmo telefone ou e-mail (possível duplicado). */
export type LeadDuplicateRef = {
  kind: "lead" | "client"
  id: string
  name: string
  createdAt: string
  /** Etapa, quando o relacionado é um lead. */
  stage: LeadStage | null
  matchedBy: ("phone" | "email")[]
}

/** Lead como a interface usa (camelCase, referências resolvidas). */
export type LeadItem = {
  id: string
  name: string
  email: string | null
  phone: string | null
  message: string | null
  interest: string | null
  typology: string | null
  source: LeadSource
  landingPageId: string | null
  landingPage: LeadLandingPageRef | null
  /** URL de entrada; sem os parâmetros de click id para quem não é dono/gerente. */
  landingUrl: string | null
  propertyId: string | null
  property: LeadPropertyRef | null
  clientId: string | null
  stage: LeadStage
  position: number | null
  assignedTo: string | null
  /** Quando o responsável atual recebeu o lead (base do prazo de 1º contato). */
  assignedAt: string | null
  /** Prazo do 1º contato calculado pelo banco; null quando não há prazo correndo. */
  firstResponseDueAt: string | null
  /** Quando saiu o aviso de "o prazo vai estourar". */
  slaWarnedAt: string | null
  /** Quantas vezes o lead voltou para a roleta por estouro do prazo. */
  slaReassignments: number
  /** Lead fora do horário de plantão, esperando a próxima janela do rodízio. */
  routingDueAt: string | null
  utm: LeadUtm
  /** Plataforma de anúncio detectada pelos click ids (visível a todos). */
  adPlatforms: LeadAdPlatform[]
  /** Ids crus de clique: só para dono e gerente (null para os demais). */
  clickIds: LeadClickIds | null
  /** Id do evento (deduplicação de conversões): só para dono e gerente. */
  eventId: string | null
  referrer: string | null
  consentAt: string | null
  lostReason: string | null
  /** Último contato registrado (muda a cada "Registrar contato" ou WhatsApp). */
  lastContactAt: string | null
  /** Primeiro contato: gravado uma vez pelo banco, base do prazo e dos relatórios. */
  firstContactAt: string | null
  /**
   * Prazo do 1º contato estourado sem outro corretor elegível no rodízio: o lead
   * ficou com o responsável e a gestão foi avisada.
   */
  slaBreachedAt: string | null
  createdAt: string
  updatedAt: string
  /**
   * Sinal de duplicado (RPC `lead_duplicate_flags`, sem expor o registro).
   * Fonte do badge "Possível duplicado"; pode ser `true` mesmo com
   * `duplicates` vazio, quando o duplicado existe mas o RLS não deixa ver.
   */
  hasDuplicate: boolean
  /** Duplicados visíveis pelo RLS (para a lista de "registros relacionados" no detalhe). */
  duplicates: LeadDuplicateRef[]
}

export type LeadRefs = {
  landingPages: ReadonlyMap<string, LeadLandingPageRef>
  properties: ReadonlyMap<string, LeadPropertyRef>
  duplicates: ReadonlyMap<string, LeadDuplicateRef[]>
  duplicateFlags: ReadonlyMap<string, boolean>
}

export type LeadItemOptions = {
  /** Dono/gerente: recebe click ids crus, event_id e URLs completas. */
  showTrackingIds: boolean
}

function toNumberOrNull(value: unknown) {
  if (value === null || value === undefined || value === "") return null
  const parsed = typeof value === "number" ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

export function toLeadItem(row: LeadRow, refs: LeadRefs, options: LeadItemOptions): LeadItem {
  // Colunas novas podem ainda não existir no banco: `?? null` cobre o undefined.
  const landingUrl = row.landing_url ?? null
  const storedClickIds = readLeadClickIds(row.click_ids ?? null)
  const clickIds =
    Object.keys(storedClickIds).length > 0 ? storedClickIds : readClickIdsFromUrl(landingUrl)
  const hasClickIds = Object.keys(clickIds).length > 0
  const { showTrackingIds } = options

  return {
    id: row.id,
    name: row.name,
    email: row.email,
    phone: row.phone,
    message: row.message,
    interest: row.interest,
    typology: row.typology ?? null,
    source: row.source,
    landingPageId: row.landing_page_id,
    landingPage: row.landing_page_id ? (refs.landingPages.get(row.landing_page_id) ?? null) : null,
    landingUrl: showTrackingIds ? landingUrl : stripClickIdParams(landingUrl),
    propertyId: row.property_id,
    property: row.property_id ? (refs.properties.get(row.property_id) ?? null) : null,
    clientId: row.client_id,
    stage: row.stage,
    position: toNumberOrNull(row.position),
    assignedTo: row.assigned_to,
    assignedAt: row.assigned_at ?? null,
    firstResponseDueAt: row.first_response_due_at ?? null,
    slaWarnedAt: row.sla_warned_at ?? null,
    slaReassignments: toNumberOrNull(row.sla_reassignments) ?? 0,
    routingDueAt: row.routing_due_at ?? null,
    utm: readLeadUtm(row.utm),
    adPlatforms: detectAdPlatforms(clickIds),
    clickIds: showTrackingIds && hasClickIds ? clickIds : null,
    eventId: showTrackingIds ? (row.event_id ?? null) : null,
    referrer:
      showTrackingIds || !row.referrer
        ? row.referrer
        : (stripClickIdParams(row.referrer) ?? row.referrer),
    consentAt: row.consent_at,
    lostReason: row.lost_reason,
    lastContactAt: row.last_contact_at,
    firstContactAt: row.first_contact_at ?? null,
    slaBreachedAt: row.sla_breached_at ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    hasDuplicate: refs.duplicateFlags.get(row.id) ?? false,
    duplicates: refs.duplicates.get(row.id) ?? [],
  }
}

export type LeadClientSummary = {
  id: string
  name: string
  kind: Enums<"client_kind">
}

export type LeadActivityItem = {
  id: string
  type: Enums<"activity_type">
  body: string | null
  occurredAt: string
  createdBy: string | null
  property: LeadPropertyRef | null
}

// -----------------------------------------------------------------------------
// Histórico do lead (lead_stage_events + lead_assignment_events)
// -----------------------------------------------------------------------------

/** Mudança de etapa registrada pelo banco. */
export type LeadStageHistoryEvent = {
  kind: "stage"
  id: string
  at: string
  /** Nome de quem fez; "Sistema" quando foi o próprio banco (rodízio, cron). */
  actorName: string
  /** Motivo em pt-BR; null quando o banco não registrou nenhum. */
  reasonLabel: string | null
  /** null no primeiro evento (o lead entrando no funil). */
  fromStage: LeadStage | null
  toStage: LeadStage
}

/** Troca de responsável registrada pelo banco. */
export type LeadAssignmentHistoryEvent = {
  kind: "assignment"
  id: string
  at: string
  actorName: string
  reasonLabel: string
  /** null quando o lead não tinha responsável antes. */
  fromName: string | null
  /** null quando o lead ficou sem responsável. */
  toName: string | null
}

/** Contato ou tentativa registrada pela equipe (`lead_contact_events`). */
export type LeadContactHistoryEvent = {
  kind: "contact"
  id: string
  at: string
  actorName: string
  reasonLabel: null
  channel: LeadContactChannel
  /** true: conseguiu falar (conta como contato); false: só a tentativa. */
  reached: boolean
}

export type LeadHistoryEvent =
  LeadStageHistoryEvent | LeadAssignmentHistoryEvent | LeadContactHistoryEvent

/** Dados que só existem depois da conversão (ficha do cliente e histórico). */
export type LeadDetailExtras = {
  client: LeadClientSummary | null
  activities: LeadActivityItem[]
  activitiesFailed: boolean
  /** Linha do tempo do lead, em ordem cronológica. */
  history: LeadHistoryEvent[]
  historyFailed: boolean
}

export const EMPTY_LEAD_DETAIL_EXTRAS: LeadDetailExtras = {
  client: null,
  activities: [],
  activitiesFailed: false,
  history: [],
  historyFailed: false,
}

/** Rodízio e SLA da imobiliária (`lead_routing_settings`), já com os padrões aplicados. */
export type LeadSlaSettings = {
  slaMinutes: number
  warningPercent: number
  rouletteEnabled: boolean
  slaReassignEnabled: boolean
  maxReassignments: number
}

export type LeadSummaryCounts = {
  /** Etapa "Novo" e nenhum contato registrado. */
  newWithoutContact: number
  /** Leads em aberto (qualquer etapa) sem 1º contato que passaram da meta. */
  overdue: number
  /** Entraram hoje (fuso de Brasília). */
  today: number
  failed: boolean
}

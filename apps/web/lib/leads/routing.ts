import type { SupabaseClient } from "@supabase/supabase-js"
import { z } from "zod"

import {
  LEAD_ROUTING_MAX_DAILY_LIMIT,
  LEAD_ROUTING_MAX_WEIGHT,
  LEAD_ROUTING_MIN_WEIGHT,
  LEAD_SLA_MAX_MINUTES,
  LEAD_SLA_MAX_REASSIGNMENTS,
  LEAD_SLA_MAX_WARNING_PERCENT,
  LEAD_SLA_MIN_MINUTES,
  LEAD_SLA_MIN_WARNING_PERCENT,
  normalizeShift,
} from "@workspace/core/leads/routing"
import type { Database } from "@workspace/database/types"

import { isRole, type Role } from "@/lib/auth/roles"

/**
 * Rodízio (roleta) de leads: leitura do painel e schemas dos formulários.
 *
 * Sem `server-only` de propósito: os mesmos schemas validam o formulário no
 * navegador (zodResolver) e a Server Action no servidor. Por isso o cliente
 * Supabase chega por parâmetro — quem monta a sessão é a página (Server
 * Component), que importa `createClient` de `@/lib/supabase/server`.
 *
 * Toda a agregação (leads do dia, em aberto, fora do prazo, tempo médio) é
 * feita pela RPC `get_lead_routing_overview`; aqui só validamos a resposta.
 */

export const LEAD_ROUTING_MIN_DAILY_LIMIT = 1
export const LEAD_SLA_MIN_REASSIGNMENTS = 0

/** Limite do banco: cada corretor aceita no máximo 21 janelas de plantão. */
export const LEAD_ROUTING_MAX_SHIFTS_PER_MEMBER = 21

/** Passo dos horários oferecidos na escala (meia em meia hora). */
export const LEAD_ROUTING_SHIFT_STEP_MINUTES = 30

const MINUTES_PER_DAY = 1440

// -----------------------------------------------------------------------------
// Apresentação (dias da semana e horários)
// -----------------------------------------------------------------------------

/** 0 = domingo … 6 = sábado, igual a `extract(dow)` no Postgres. */
export const WEEKDAY_LABELS = [
  "Domingo",
  "Segunda-feira",
  "Terça-feira",
  "Quarta-feira",
  "Quinta-feira",
  "Sexta-feira",
  "Sábado",
] as const

export const WEEKDAY_SHORT_LABELS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"] as const

export const WEEKDAY_VALUES = [0, 1, 2, 3, 4, 5, 6] as const

export function weekdayLabel(weekday: number) {
  return WEEKDAY_LABELS[weekday] ?? "Dia inválido"
}

export function weekdayShortLabel(weekday: number) {
  return WEEKDAY_SHORT_LABELS[weekday] ?? "—"
}

/** Minutos desde 00:00 em "HH:MM"; 1440 vira "24:00" (meia-noite seguinte). */
export function formatMinuteOfDay(minute: number) {
  const total = Math.min(Math.max(Math.trunc(minute), 0), MINUTES_PER_DAY)
  const hours = Math.floor(total / 60)
  const minutes = total % 60

  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`
}

/** "09:00 – 18:00". */
export function formatShiftRange(shift: { startMinute: number; endMinute: number }) {
  return `${formatMinuteOfDay(shift.startMinute)} – ${formatMinuteOfDay(shift.endMinute)}`
}

/** Horários oferecidos nos selects da escala, de meia em meia hora. */
function shiftTimeOptions(from: number, to: number) {
  const options: { value: number; label: string }[] = []

  for (let minute = from; minute <= to; minute += LEAD_ROUTING_SHIFT_STEP_MINUTES) {
    options.push({
      value: minute,
      label: minute === MINUTES_PER_DAY ? "24:00 (fim do dia)" : formatMinuteOfDay(minute),
    })
  }

  return options
}

export const SHIFT_START_OPTIONS = shiftTimeOptions(
  0,
  MINUTES_PER_DAY - LEAD_ROUTING_SHIFT_STEP_MINUTES
)
export const SHIFT_END_OPTIONS = shiftTimeOptions(LEAD_ROUTING_SHIFT_STEP_MINUTES, MINUTES_PER_DAY)

/** Fusos usados no Brasil, para o gestor não precisar digitar o nome IANA. */
export const LEAD_ROUTING_TIME_ZONE_OPTIONS = [
  { value: "America/Sao_Paulo", label: "Brasília (São Paulo, Rio, Sul e Sudeste)" },
  { value: "America/Bahia", label: "Salvador (Bahia)" },
  { value: "America/Fortaleza", label: "Fortaleza (Ceará, Rio Grande do Norte, Paraíba)" },
  { value: "America/Recife", label: "Recife (Pernambuco)" },
  { value: "America/Maceio", label: "Maceió (Alagoas e Sergipe)" },
  { value: "America/Belem", label: "Belém (Pará e Amapá)" },
  { value: "America/Araguaina", label: "Palmas (Tocantins)" },
  { value: "America/Campo_Grande", label: "Campo Grande (Mato Grosso do Sul)" },
  { value: "America/Cuiaba", label: "Cuiabá (Mato Grosso)" },
  { value: "America/Manaus", label: "Manaus (Amazonas)" },
  { value: "America/Porto_Velho", label: "Porto Velho (Rondônia)" },
  { value: "America/Boa_Vista", label: "Boa Vista (Roraima)" },
  { value: "America/Rio_Branco", label: "Rio Branco (Acre)" },
  { value: "America/Noronha", label: "Fernando de Noronha" },
] as const

export function timeZoneLabel(timeZone: string) {
  return (
    LEAD_ROUTING_TIME_ZONE_OPTIONS.find((option) => option.value === timeZone)?.label ?? timeZone
  )
}

// -----------------------------------------------------------------------------
// Painel do rodízio (RPC get_lead_routing_overview)
// -----------------------------------------------------------------------------

export type LeadRoutingSettings = {
  organizationId: string
  rouletteEnabled: boolean
  respectSchedule: boolean
  fallbackToPageAssignee: boolean
  slaMinutes: number
  slaReassignEnabled: boolean
  slaWarningPercent: number
  maxReassignments: number
  timeZone: string
  /** false = a imobiliária ainda não salvou nada (valem os padrões do banco). */
  configured: boolean
}

export type LeadRoutingShift = {
  id: string
  weekday: number
  startMinute: number
  endMinute: number
}

export type LeadRoutingQueueMember = {
  id: string
  userId: string
  /** Papel na imobiliária; null se a pessoa saiu da equipe. */
  role: Role | null
  /** Continua na equipe (memberships.active). */
  memberActive: boolean
  /** Ligado na fila do rodízio. */
  active: boolean
  weight: number
  dailyLimit: number | null
  awayFrom: string | null
  awayUntil: string | null
  awayNow: boolean
  onShift: boolean
  lastAssignedAt: string | null
  assignedToday: number
  openLeads: number
  overdueLeads: number
  avgFirstResponseMinutes: number | null
  shifts: LeadRoutingShift[]
}

export type LeadRoutingTotals = {
  leadsToday: number
  unassigned: number
  queued: number
  overdue: number
  reassigned7d: number
  answeredInTime7d: number
  answered7d: number
}

export type LeadRoutingOverview = {
  settings: LeadRoutingSettings
  members: LeadRoutingQueueMember[]
  totals: LeadRoutingTotals
  /** Instante da leitura, no relógio do banco. */
  now: string
}

const countSchema = z.number().int().nonnegative().catch(0)
const flagSchema = z.boolean().nullable().catch(null)

const overviewShiftSchema = z.object({
  id: z.string(),
  weekday: z.number().int(),
  start_minute: z.number().int(),
  end_minute: z.number().int(),
})

const overviewMemberSchema = z.object({
  id: z.string(),
  user_id: z.string(),
  role: z.string().nullable().catch(null),
  member_active: flagSchema,
  active: z.boolean(),
  weight: z.number().int(),
  daily_limit: z.number().int().nullable(),
  away_from: z.string().nullable(),
  away_until: z.string().nullable(),
  away_now: flagSchema,
  on_shift: flagSchema,
  last_assigned_at: z.string().nullable(),
  assigned_today: countSchema,
  open_leads: countSchema,
  overdue_leads: countSchema,
  avg_first_response_minutes: z.number().nullable().catch(null),
  shifts: z.array(overviewShiftSchema).catch([]),
})

const overviewTotalsSchema = z.object({
  leads_today: countSchema.default(0),
  unassigned: countSchema.default(0),
  queued: countSchema.default(0),
  overdue: countSchema.default(0),
  reassigned_7d: countSchema.default(0),
  answered_in_time_7d: countSchema.default(0),
  answered_7d: countSchema.default(0),
})

const overviewSchema = z.object({
  settings: z.object({
    organization_id: z.string(),
    roulette_enabled: z.boolean(),
    respect_schedule: z.boolean(),
    fallback_to_page_assignee: z.boolean(),
    sla_minutes: z.number().int(),
    sla_reassign_enabled: z.boolean(),
    sla_warning_percent: z.number().int(),
    max_reassignments: z.number().int(),
    time_zone: z.string(),
    configured: z.boolean(),
  }),
  members: z.array(overviewMemberSchema).catch([]),
  totals: overviewTotalsSchema,
  now: z.string(),
})

/** Resposta da RPC já em camelCase. Lança se o formato não for o esperado. */
export function parseLeadRoutingOverview(raw: unknown): LeadRoutingOverview {
  const parsed = overviewSchema.safeParse(raw)

  if (!parsed.success) {
    throw new Error("Não foi possível ler a configuração do rodízio de leads.")
  }

  const { settings, members, totals, now } = parsed.data

  return {
    settings: {
      organizationId: settings.organization_id,
      rouletteEnabled: settings.roulette_enabled,
      respectSchedule: settings.respect_schedule,
      fallbackToPageAssignee: settings.fallback_to_page_assignee,
      slaMinutes: settings.sla_minutes,
      slaReassignEnabled: settings.sla_reassign_enabled,
      slaWarningPercent: settings.sla_warning_percent,
      maxReassignments: settings.max_reassignments,
      timeZone: settings.time_zone,
      configured: settings.configured,
    },
    members: members.map((member) => ({
      id: member.id,
      userId: member.user_id,
      role: isRole(member.role) ? member.role : null,
      memberActive: member.member_active === true,
      active: member.active,
      weight: member.weight,
      dailyLimit: member.daily_limit,
      awayFrom: member.away_from,
      awayUntil: member.away_until,
      awayNow: member.away_now === true,
      onShift: member.on_shift !== false,
      lastAssignedAt: member.last_assigned_at,
      assignedToday: member.assigned_today,
      openLeads: member.open_leads,
      overdueLeads: member.overdue_leads,
      avgFirstResponseMinutes: member.avg_first_response_minutes,
      shifts: member.shifts
        .map((shift) => ({
          id: shift.id,
          weekday: shift.weekday,
          startMinute: shift.start_minute,
          endMinute: shift.end_minute,
        }))
        .sort((a, b) => a.weekday - b.weekday || a.startMinute - b.startMinute),
    })),
    totals: {
      leadsToday: totals.leads_today,
      unassigned: totals.unassigned,
      queued: totals.queued,
      overdue: totals.overdue,
      reassigned7d: totals.reassigned_7d,
      answeredInTime7d: totals.answered_in_time_7d,
      answered7d: totals.answered_7d,
    },
    now,
  }
}

/**
 * Configuração, fila e números do rodízio. O cliente vem de quem chama porque
 * este módulo também é usado no navegador (veja o comentário do topo).
 */
export async function getLeadRoutingOverview(
  supabase: SupabaseClient<Database>,
  organizationId: string
): Promise<LeadRoutingOverview> {
  const { data, error } = await supabase.rpc("get_lead_routing_overview", {
    p_organization_id: organizationId,
  })

  if (error) {
    throw new Error(`Não foi possível carregar o rodízio de leads (${error.code ?? "erro"}).`)
  }

  return parseLeadRoutingOverview(data)
}

/** Situação da pessoa na fila, já pronta para virar etiqueta na tabela. */
export type LeadRoutingMemberStatus = "left_team" | "paused" | "away" | "off_shift" | "ready"

export function leadRoutingMemberStatus(
  member: LeadRoutingQueueMember,
  respectSchedule: boolean
): LeadRoutingMemberStatus {
  if (!member.memberActive) return "left_team"
  if (!member.active) return "paused"
  if (member.awayNow) return "away"
  if (respectSchedule && !member.onShift) return "off_shift"

  return "ready"
}

export const LEAD_ROUTING_MEMBER_STATUS_LABELS: Record<LeadRoutingMemberStatus, string> = {
  left_team: "Fora da equipe",
  paused: "Pausado",
  away: "De férias",
  off_shift: "Fora do plantão agora",
  ready: "Recebendo leads",
}

// -----------------------------------------------------------------------------
// Schemas dos formulários
// -----------------------------------------------------------------------------

const optionalDateTime = z
  .string()
  .trim()
  .max(40, "Data inválida.")
  .refine(
    (value) => value === "" || !Number.isNaN(new Date(value).getTime()),
    "Informe uma data e hora válidas."
  )

/** Texto vazio vira null; o resto vira ISO (o banco guarda timestamptz). */
export function toIsoOrNull(value: string): string | null {
  if (value.trim() === "") {
    return null
  }

  const parsed = new Date(value)

  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString()
}

/** ISO do banco no formato que o `<input type="datetime-local">` entende. */
export function toDateTimeLocalInput(value: string | null): string {
  if (!value) {
    return ""
  }

  const parsed = new Date(value)

  if (Number.isNaN(parsed.getTime())) {
    return ""
  }

  const pad = (part: number) => String(part).padStart(2, "0")

  return `${parsed.getFullYear()}-${pad(parsed.getMonth() + 1)}-${pad(parsed.getDate())}T${pad(
    parsed.getHours()
  )}:${pad(parsed.getMinutes())}`
}

export const leadRoutingSettingsSchema = z.object({
  rouletteEnabled: z.boolean(),
  respectSchedule: z.boolean(),
  fallbackToPageAssignee: z.boolean(),
  slaReassignEnabled: z.boolean(),
  slaMinutes: z
    .number({ error: "Informe o prazo em minutos." })
    .int("Use um número inteiro de minutos.")
    .min(LEAD_SLA_MIN_MINUTES, `O prazo mínimo é de ${LEAD_SLA_MIN_MINUTES} minuto.`)
    .max(LEAD_SLA_MAX_MINUTES, `O prazo máximo é de ${LEAD_SLA_MAX_MINUTES} minutos (24 horas).`),
  slaWarningPercent: z
    .number({ error: "Informe o percentual do aviso." })
    .int("Use um número inteiro.")
    .min(
      LEAD_SLA_MIN_WARNING_PERCENT,
      `O aviso vai de ${LEAD_SLA_MIN_WARNING_PERCENT}% a ${LEAD_SLA_MAX_WARNING_PERCENT}%.`
    )
    .max(
      LEAD_SLA_MAX_WARNING_PERCENT,
      `O aviso vai de ${LEAD_SLA_MIN_WARNING_PERCENT}% a ${LEAD_SLA_MAX_WARNING_PERCENT}%.`
    ),
  maxReassignments: z
    .number({ error: "Informe quantas vezes o lead pode girar." })
    .int("Use um número inteiro.")
    .min(LEAD_SLA_MIN_REASSIGNMENTS, "O mínimo é 0.")
    .max(LEAD_SLA_MAX_REASSIGNMENTS, `O máximo é ${LEAD_SLA_MAX_REASSIGNMENTS}.`),
  timeZone: z
    .string()
    .trim()
    .min(3, "Selecione o fuso horário da imobiliária.")
    .max(64, "Fuso horário inválido."),
})

export type LeadRoutingSettingsValues = z.infer<typeof leadRoutingSettingsSchema>

export const leadRoutingMemberSchema = z
  .object({
    /** Preenchido só na edição; null cria um novo corretor na fila. */
    id: z.guid("Corretor inválido.").nullable(),
    userId: z.guid("Escolha quem entra na fila."),
    active: z.boolean(),
    weight: z
      .number({ error: "Escolha o peso." })
      .int("Use um número inteiro.")
      .min(
        LEAD_ROUTING_MIN_WEIGHT,
        `O peso vai de ${LEAD_ROUTING_MIN_WEIGHT} a ${LEAD_ROUTING_MAX_WEIGHT}.`
      )
      .max(
        LEAD_ROUTING_MAX_WEIGHT,
        `O peso vai de ${LEAD_ROUTING_MIN_WEIGHT} a ${LEAD_ROUTING_MAX_WEIGHT}.`
      ),
    dailyLimit: z
      .number({ error: "Informe um número de leads por dia." })
      .int("Use um número inteiro.")
      .min(LEAD_ROUTING_MIN_DAILY_LIMIT, "O limite diário começa em 1 lead.")
      .max(
        LEAD_ROUTING_MAX_DAILY_LIMIT,
        `O limite diário vai até ${LEAD_ROUTING_MAX_DAILY_LIMIT} leads.`
      )
      .nullable(),
    awayFrom: optionalDateTime,
    awayUntil: optionalDateTime,
  })
  .refine(
    (values) =>
      values.awayFrom === "" ||
      values.awayUntil === "" ||
      new Date(values.awayUntil) > new Date(values.awayFrom),
    { message: "A volta precisa ser depois da saída.", path: ["awayUntil"] }
  )

export type LeadRoutingMemberValues = z.infer<typeof leadRoutingMemberSchema>

export const LEAD_ROUTING_MEMBER_DEFAULTS: LeadRoutingMemberValues = {
  id: null,
  userId: "",
  active: true,
  weight: 1,
  dailyLimit: null,
  awayFrom: "",
  awayUntil: "",
}

export const leadRoutingShiftSchema = z
  .object({
    weekday: z
      .number({ error: "Escolha o dia da semana." })
      .int()
      .min(0, "Escolha o dia da semana.")
      .max(6, "Escolha o dia da semana."),
    startMinute: z
      .number({ error: "Escolha a hora de início." })
      .int()
      .min(0, "Escolha a hora de início.")
      .max(MINUTES_PER_DAY - 1, "Escolha a hora de início."),
    endMinute: z
      .number({ error: "Escolha a hora de fim." })
      .int()
      .min(1, "Escolha a hora de fim.")
      .max(MINUTES_PER_DAY, "Escolha a hora de fim."),
  })
  .refine((values) => normalizeShift(values) !== null, {
    message: "O fim do plantão precisa ser depois do início.",
    path: ["endMinute"],
  })

export type LeadRoutingShiftValues = z.infer<typeof leadRoutingShiftSchema>

export const LEAD_ROUTING_SHIFT_DEFAULTS: LeadRoutingShiftValues = {
  weekday: 1,
  startMinute: 9 * 60,
  endMinute: 18 * 60,
}

export const bulkReassignSchema = z
  .object({
    fromUserId: z.guid("Escolha de quem são os leads."),
    /** null devolve os leads para a roleta (ou os deixa sem responsável). */
    toUserId: z.guid("Escolha o novo responsável.").nullable(),
    includeClosed: z.boolean(),
  })
  .refine((values) => values.toUserId === null || values.toUserId !== values.fromUserId, {
    message: "Escolha um responsável diferente do atual.",
    path: ["toUserId"],
  })

export type BulkReassignValues = z.infer<typeof bulkReassignSchema>

export const BULK_REASSIGN_DEFAULTS: BulkReassignValues = {
  fromUserId: "",
  toUserId: null,
  includeClosed: false,
}

/** O que a RPC `bulk_reassign_leads` devolveu. */
export type BulkReassignSummary = {
  moved: number
  queued: number
  unassigned: number
  mode: "transfer" | "roulette" | "release"
}

const bulkReassignResultSchema = z.object({
  moved: countSchema,
  queued: countSchema,
  unassigned: countSchema,
  mode: z.enum(["transfer", "roulette", "release"]).catch("transfer"),
})

export function parseBulkReassignResult(raw: unknown): BulkReassignSummary {
  const parsed = bulkReassignResultSchema.safeParse(raw)

  return parsed.success ? parsed.data : { moved: 0, queued: 0, unassigned: 0, mode: "transfer" }
}

function pluralLeads(count: number) {
  return count === 1 ? "1 lead" : `${count} leads`
}

/** Frase em pt-BR contando o que a reatribuição em massa fez. */
export function describeBulkReassign(summary: BulkReassignSummary) {
  if (summary.mode === "transfer") {
    return summary.moved === 0
      ? "Nenhum lead para transferir."
      : `${pluralLeads(summary.moved)} ${summary.moved === 1 ? "transferido" : "transferidos"}.`
  }

  if (summary.mode === "release") {
    return summary.unassigned === 0
      ? "Nenhum lead para devolver."
      : `${pluralLeads(summary.unassigned)} ${
          summary.unassigned === 1 ? "ficou" : "ficaram"
        } sem responsável.`
  }

  const parts: string[] = []

  if (summary.moved > 0) {
    parts.push(
      `${pluralLeads(summary.moved)} ${summary.moved === 1 ? "devolvido" : "devolvidos"} para a roleta`
    )
  }

  if (summary.queued > 0) {
    parts.push(
      `${pluralLeads(summary.queued)} ${summary.queued === 1 ? "aguardando" : "aguardando"} a próxima janela`
    )
  }

  if (summary.unassigned > 0) {
    parts.push(`${pluralLeads(summary.unassigned)} sem ninguém disponível`)
  }

  if (parts.length === 0) {
    return "Nenhum lead para devolver."
  }

  return `${parts.join(", ")}.`
}

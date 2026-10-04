/**
 * Página de status — incidentes e manutenções escritos pela equipe no Console.
 *
 * Regras puras: limpeza do texto (sem HTML), limites, estados permitidos por
 * tipo, situação efetiva da manutenção pelo relógio e preparação do que vai
 * para as RPCs. O banco repete as mesmas restrições
 * (private.status_incidents e private.status_incident_updates) — aqui é para
 * validar o formulário e explicar na tela.
 *
 * Datas do formulário são no horário de Brasília (datetime-local), como nos
 * comunicados.
 */

import { z } from "zod"

import { fromBrasiliaInputValue, sanitizeAnnouncementText } from "../platform/announcements"
import { isIncidentImpact, isStatusComponentKey } from "./levels"
import {
  STATUS_COMPONENT_KEYS,
  type IncidentImpact,
  type IncidentStatus,
  type MaintenanceStatus,
  type StatusComponentKey,
} from "./public"

export const INCIDENT_KINDS = ["incident", "maintenance"] as const
export type IncidentKind = (typeof INCIDENT_KINDS)[number]

export const INCIDENT_KIND_LABELS: Record<IncidentKind, string> = {
  incident: "Incidente",
  maintenance: "Manutenção",
}

export const INCIDENT_STATUSES = ["investigating", "identified", "monitoring", "resolved"] as const
export const MAINTENANCE_STATUSES = ["scheduled", "in_progress", "completed"] as const

export type AnyIncidentStatus = IncidentStatus | MaintenanceStatus

export const INCIDENT_LIMITS = {
  titleMin: 3,
  titleMax: 120,
  messageMin: 3,
  messageMax: 2000,
  /** Manutenção: duração máxima prevista. */
  maintenanceMaxHours: 72,
  /** Manutenção: até quanto tempo no futuro dá para agendar. */
  maintenanceMaxDaysAhead: 90,
} as const

export function isIncidentKind(value: unknown): value is IncidentKind {
  return typeof value === "string" && (INCIDENT_KINDS as readonly string[]).includes(value)
}

/** Estados aceitos para o tipo. */
export function statusesForKind(kind: IncidentKind): readonly AnyIncidentStatus[] {
  return kind === "incident" ? INCIDENT_STATUSES : MAINTENANCE_STATUSES
}

export function isStatusForKind(kind: IncidentKind, value: unknown): value is AnyIncidentStatus {
  return typeof value === "string" && (statusesForKind(kind) as readonly string[]).includes(value)
}

/** Resolvido (incidente) ou concluída (manutenção): encerrado, não aceita nova atualização. */
export function isClosedIncidentStatus(status: AnyIncidentStatus): boolean {
  return status === "resolved" || status === "completed"
}

/**
 * Estados que a equipe pode publicar a partir do atual. Incidente pode ir e
 * voltar entre investigando/identificado/monitorando e fechar em resolvido.
 * Manutenção agendada pode começar ou ser concluída (cancelada); em andamento
 * só conclui. Encerrado não muda mais.
 */
export function nextIncidentStatuses(
  kind: IncidentKind,
  current: AnyIncidentStatus
): readonly AnyIncidentStatus[] {
  if (isClosedIncidentStatus(current)) {
    return []
  }

  if (kind === "incident") {
    return INCIDENT_STATUSES
  }

  return current === "scheduled"
    ? ["scheduled", "in_progress", "completed"]
    : ["in_progress", "completed"]
}

export type MaintenanceTiming = {
  status: AnyIncidentStatus
  scheduledFor: string | null
  scheduledUntil: string | null
}

/**
 * Situação efetiva de uma manutenção pelo relógio: agendada entra "em
 * andamento" sozinha no início previsto e fica "concluída" no fim previsto se
 * a equipe não mexeu. Em andamento marcada pela equipe só fecha quando a
 * equipe concluir. Incidente volta o próprio estado. Espelho de
 * `private.status_effective_status`.
 */
export function effectiveIncidentStatus(
  kind: IncidentKind,
  timing: MaintenanceTiming,
  now: Date
): AnyIncidentStatus {
  if (kind !== "maintenance" || timing.status !== "scheduled") {
    return timing.status
  }

  const start = timing.scheduledFor ? Date.parse(timing.scheduledFor) : Number.NaN
  const end = timing.scheduledUntil ? Date.parse(timing.scheduledUntil) : Number.NaN
  const time = now.getTime()

  if (Number.isFinite(end) && end <= time) {
    return "completed"
  }

  return Number.isFinite(start) && start <= time ? "in_progress" : "scheduled"
}

// ---------------------------------------------------------------------------
// Texto
// ---------------------------------------------------------------------------

/** Título: texto puro de uma linha (mesma limpeza dos comunicados). */
export function sanitizeIncidentTitle(value: unknown): string {
  return sanitizeAnnouncementText(value)
}

/**
 * Mensagem: texto puro que aceita quebras de linha. Cada linha é limpa como os
 * comunicados (sem tags, sem < >, sem caracteres de controle nem invisíveis);
 * no máximo uma linha em branco seguida; apara as pontas.
 */
export function sanitizeIncidentMessage(value: unknown): string {
  if (typeof value !== "string") {
    return ""
  }

  return value
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => sanitizeAnnouncementText(line))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

/** Partes afetadas: só chaves conhecidas, sem repetição, na ordem da página. */
export function normalizeComponentKeys(value: unknown): StatusComponentKey[] {
  const chosen = new Set(Array.isArray(value) ? value.filter(isStatusComponentKey) : [])
  return STATUS_COMPONENT_KEYS.filter((key) => chosen.has(key))
}

function lengthError(label: string, value: string, min: number, max: number): string | null {
  if (value.length < min) {
    return `${label} precisa ter pelo menos ${min} caracteres.`
  }

  return value.length > max ? `${label} pode ter até ${max} caracteres.` : null
}

export function incidentTitleError(title: string): string | null {
  return lengthError("O título", title, INCIDENT_LIMITS.titleMin, INCIDENT_LIMITS.titleMax)
}

export function incidentMessageError(message: string): string | null {
  return lengthError("A mensagem", message, INCIDENT_LIMITS.messageMin, INCIDENT_LIMITS.messageMax)
}

// ---------------------------------------------------------------------------
// Criar
// ---------------------------------------------------------------------------

export type IncidentCreateFormValues = {
  kind: IncidentKind
  title: string
  impact: IncidentImpact
  componentKeys: string[]
  /** Estado inicial do incidente (manutenção decide pelo horário). */
  status: IncidentStatus
  message: string
  /** Manutenção: "AAAA-MM-DDTHH:mm", horário de Brasília. */
  scheduledFor: string
  scheduledUntil: string
}

export type IncidentCreateField = keyof IncidentCreateFormValues

export type IncidentCreatePayload = {
  kind: IncidentKind
  title: string
  impact: IncidentImpact
  componentKeys: StatusComponentKey[]
  /** Incidente: estado escolhido; manutenção: null (o banco decide pelo horário). */
  status: IncidentStatus | null
  message: string
  /** ISO (UTC); null em incidente. */
  scheduledFor: string | null
  scheduledUntil: string | null
}

export type Preparation<Payload, Field extends string> =
  { ok: true; payload: Payload } | { ok: false; fieldErrors: Partial<Record<Field, string>> }

const HOUR_MS = 60 * 60 * 1000
const DAY_MS = 24 * HOUR_MS

type ScheduleField = "scheduledFor" | "scheduledUntil"

/**
 * Janela da manutenção: início e fim válidos, fim depois do início e no
 * futuro, até 72 h de duração e início em até 90 dias.
 */
export function prepareMaintenanceWindow(
  values: { scheduledFor?: unknown; scheduledUntil?: unknown },
  now: Date
):
  | { ok: true; scheduledFor: string; scheduledUntil: string }
  | { ok: false; fieldErrors: Partial<Record<ScheduleField, string>> } {
  const fieldErrors: Partial<Record<ScheduleField, string>> = {}
  const scheduledFor = fromBrasiliaInputValue(values.scheduledFor)
  const scheduledUntil = fromBrasiliaInputValue(values.scheduledUntil)

  if (!scheduledFor) {
    fieldErrors.scheduledFor = "Informe a data e a hora de início."
  } else if (
    Date.parse(scheduledFor) - now.getTime() >
    INCIDENT_LIMITS.maintenanceMaxDaysAhead * DAY_MS
  ) {
    fieldErrors.scheduledFor = `Agende com até ${INCIDENT_LIMITS.maintenanceMaxDaysAhead} dias de antecedência.`
  }

  if (!scheduledUntil) {
    fieldErrors.scheduledUntil = "Informe a data e a hora de fim."
  } else if (Date.parse(scheduledUntil) <= now.getTime()) {
    fieldErrors.scheduledUntil = "O fim precisa ser no futuro."
  } else if (scheduledFor && Date.parse(scheduledUntil) <= Date.parse(scheduledFor)) {
    fieldErrors.scheduledUntil = "O fim precisa ser depois do início."
  } else if (
    scheduledFor &&
    Date.parse(scheduledUntil) - Date.parse(scheduledFor) >
      INCIDENT_LIMITS.maintenanceMaxHours * HOUR_MS
  ) {
    fieldErrors.scheduledUntil = `Uma manutenção dura até ${INCIDENT_LIMITS.maintenanceMaxHours} horas.`
  }

  if (!scheduledFor || !scheduledUntil || Object.keys(fieldErrors).length > 0) {
    return { ok: false, fieldErrors }
  }

  return { ok: true, scheduledFor, scheduledUntil }
}

/** Limpa e confere um incidente ou manutenção novo antes de gravar. */
export function prepareIncidentCreate(
  values: Partial<Record<IncidentCreateField, unknown>>,
  now: Date
): Preparation<IncidentCreatePayload, IncidentCreateField> {
  const fieldErrors: Partial<Record<IncidentCreateField, string>> = {}
  const kind = isIncidentKind(values.kind) ? values.kind : null
  const title = sanitizeIncidentTitle(values.title)
  const message = sanitizeIncidentMessage(values.message)
  const componentKeys = normalizeComponentKeys(values.componentKeys)

  if (!kind) {
    fieldErrors.kind = "Escolha entre incidente e manutenção."
  }

  const titleError = incidentTitleError(title)
  if (titleError) fieldErrors.title = titleError

  const messageError = incidentMessageError(message)
  if (messageError) fieldErrors.message = messageError

  if (!isIncidentImpact(values.impact)) {
    fieldErrors.impact = "Escolha o impacto."
  }

  if (componentKeys.length === 0) {
    fieldErrors.componentKeys = "Marque pelo menos uma parte do sistema."
  }

  let scheduledFor: string | null = null
  let scheduledUntil: string | null = null
  let status: IncidentStatus | null = null

  if (kind === "incident") {
    if (
      !isStatusForKind("incident", values.status) ||
      isClosedIncidentStatus(values.status as IncidentStatus)
    ) {
      fieldErrors.status = "Escolha o estado inicial (investigando, identificado ou monitorando)."
    } else {
      status = values.status as IncidentStatus
    }
  }

  if (kind === "maintenance") {
    const window = prepareMaintenanceWindow(values, now)

    if (window.ok) {
      scheduledFor = window.scheduledFor
      scheduledUntil = window.scheduledUntil
    } else {
      Object.assign(fieldErrors, window.fieldErrors)
    }
  }

  if (!kind || Object.keys(fieldErrors).length > 0) {
    return { ok: false, fieldErrors }
  }

  return {
    ok: true,
    payload: {
      kind,
      title,
      impact: values.impact as IncidentImpact,
      componentKeys,
      status,
      message,
      scheduledFor,
      scheduledUntil,
    },
  }
}

// ---------------------------------------------------------------------------
// Publicar atualização
// ---------------------------------------------------------------------------

export type IncidentUpdateFormValues = {
  status: AnyIncidentStatus
  message: string
}

export type IncidentUpdateField = keyof IncidentUpdateFormValues

export type IncidentUpdatePayload = {
  status: AnyIncidentStatus
  message: string
}

/** Nova atualização: estado permitido a partir do atual e mensagem válida. */
export function prepareIncidentUpdate(
  values: Partial<Record<IncidentUpdateField, unknown>>,
  context: { kind: IncidentKind; currentStatus: AnyIncidentStatus }
): Preparation<IncidentUpdatePayload, IncidentUpdateField> {
  const fieldErrors: Partial<Record<IncidentUpdateField, string>> = {}
  const message = sanitizeIncidentMessage(values.message)
  const allowed = nextIncidentStatuses(context.kind, context.currentStatus)

  if (allowed.length === 0) {
    fieldErrors.status = "Este registro já foi encerrado e não aceita novas atualizações."
  } else if (
    typeof values.status !== "string" ||
    !(allowed as readonly string[]).includes(values.status)
  ) {
    fieldErrors.status = "Escolha um estado válido."
  }

  const messageError = incidentMessageError(message)
  if (messageError) fieldErrors.message = messageError

  if (Object.keys(fieldErrors).length > 0) {
    return { ok: false, fieldErrors }
  }

  return { ok: true, payload: { status: values.status as AnyIncidentStatus, message } }
}

// ---------------------------------------------------------------------------
// Editar
// ---------------------------------------------------------------------------

export type IncidentEditFormValues = {
  title: string
  impact: IncidentImpact
  componentKeys: string[]
  /** Só manutenção ainda não começada. */
  scheduledFor: string
  scheduledUntil: string
}

export type IncidentEditField = keyof IncidentEditFormValues

export type IncidentEditPayload = {
  title: string
  impact: IncidentImpact
  componentKeys: StatusComponentKey[]
  scheduledFor: string | null
  scheduledUntil: string | null
}

/**
 * Edição do título, impacto e partes afetadas (e da janela, se for manutenção
 * ainda agendada). Encerrado só aceita correção do título: impacto e partes
 * contam a história e ficam como estavam.
 */
export function prepareIncidentEdit(
  values: Partial<Record<IncidentEditField, unknown>>,
  context: {
    kind: IncidentKind
    status: AnyIncidentStatus
    impact: IncidentImpact
    componentKeys: readonly StatusComponentKey[]
  },
  now: Date
): Preparation<IncidentEditPayload, IncidentEditField> {
  const fieldErrors: Partial<Record<IncidentEditField, string>> = {}
  const title = sanitizeIncidentTitle(values.title)
  const componentKeys = normalizeComponentKeys(values.componentKeys)
  const closed = isClosedIncidentStatus(context.status)

  const titleError = incidentTitleError(title)
  if (titleError) fieldErrors.title = titleError

  if (!isIncidentImpact(values.impact)) {
    fieldErrors.impact = "Escolha o impacto."
  } else if (closed && values.impact !== context.impact) {
    fieldErrors.impact = "Registro encerrado: o impacto não muda mais."
  }

  if (componentKeys.length === 0) {
    fieldErrors.componentKeys = "Marque pelo menos uma parte do sistema."
  } else if (
    closed &&
    componentKeys.join(",") !== normalizeComponentKeys(context.componentKeys).join(",")
  ) {
    fieldErrors.componentKeys = "Registro encerrado: as partes afetadas não mudam mais."
  }

  let scheduledFor: string | null = null
  let scheduledUntil: string | null = null

  if (context.kind === "maintenance" && context.status === "scheduled") {
    const window = prepareMaintenanceWindow(values, now)

    if (window.ok) {
      scheduledFor = window.scheduledFor
      scheduledUntil = window.scheduledUntil
    } else {
      Object.assign(fieldErrors, window.fieldErrors)
    }
  }

  if (Object.keys(fieldErrors).length > 0) {
    return { ok: false, fieldErrors }
  }

  return {
    ok: true,
    payload: {
      title,
      impact: values.impact as IncidentImpact,
      componentKeys,
      scheduledFor,
      scheduledUntil,
    },
  }
}

// ---------------------------------------------------------------------------
// Esquemas dos formulários (mesmas regras, com o relógio do navegador)
// ---------------------------------------------------------------------------

function addFieldErrors(
  context: z.RefinementCtx,
  fieldErrors: Partial<Record<string, string>>
): void {
  for (const [field, message] of Object.entries(fieldErrors)) {
    if (message) {
      context.addIssue({ code: "custom", path: [field], message })
    }
  }
}

export const incidentCreateFormSchema = z
  .object({
    kind: z.enum(INCIDENT_KINDS),
    title: z.string(),
    impact: z.enum(["none", "minor", "major", "critical"]),
    componentKeys: z.array(z.string()),
    status: z.enum(INCIDENT_STATUSES),
    message: z.string(),
    scheduledFor: z.string(),
    scheduledUntil: z.string(),
  })
  .superRefine((values, context) => {
    const result = prepareIncidentCreate(values, new Date())
    if (!result.ok) addFieldErrors(context, result.fieldErrors)
  })

export function incidentUpdateFormSchema(context: {
  kind: IncidentKind
  currentStatus: AnyIncidentStatus
}) {
  return z
    .object({
      status: z.enum([...INCIDENT_STATUSES, ...MAINTENANCE_STATUSES]),
      message: z.string(),
    })
    .superRefine((values, refinement) => {
      const result = prepareIncidentUpdate(values, context)
      if (!result.ok) addFieldErrors(refinement, result.fieldErrors)
    })
}

export function incidentEditFormSchema(context: {
  kind: IncidentKind
  status: AnyIncidentStatus
  impact: IncidentImpact
  componentKeys: readonly StatusComponentKey[]
}) {
  return z
    .object({
      title: z.string(),
      impact: z.enum(["none", "minor", "major", "critical"]),
      componentKeys: z.array(z.string()),
      scheduledFor: z.string(),
      scheduledUntil: z.string(),
    })
    .superRefine((values, refinement) => {
      const result = prepareIncidentEdit(values, context, new Date())
      if (!result.ok) addFieldErrors(refinement, result.fieldErrors)
    })
}

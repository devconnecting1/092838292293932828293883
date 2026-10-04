"use server"

import { revalidatePath, revalidateTag } from "next/cache"

import { PLATFORM_READ_ONLY_MESSAGE } from "@workspace/core/platform/staff"

import {
  prepareIncidentCreate,
  prepareIncidentEdit,
  prepareIncidentUpdate,
  type IncidentCreateField,
  type IncidentEditField,
  type IncidentUpdateField,
} from "@workspace/core/status/incidents"

import { canAct, getPlatformAdmin } from "@/lib/plataforma/admin"
import { PLATFORM_RPC_FAILURE_MESSAGES } from "@/lib/plataforma/rpc"
import {
  addStatusIncidentUpdate,
  createStatusIncident,
  editStatusIncident,
  listStatusIncidents,
  PLATFORM_STATUS_PATH,
  statusIncidentFailureMessage,
  takeOverStatusIncident,
  type StatusConsoleIncident,
} from "@/lib/status/console"
import { PUBLIC_STATUS_CACHE_TAG } from "@/lib/status/public"

/**
 * Server Actions do status público (incidentes e manutenções). Cada uma confere
 * o administrador de novo (a RPC confere mais uma vez) e valida tudo no
 * servidor. Para atualizar ou editar, o tipo, o estado, o impacto e as partes
 * vêm do registro relido do banco — o contexto enviado pelo navegador só serve
 * para avisar que a página ficou desatualizada, nunca para liberar algo.
 *
 * O estado usado é o efetivo (o que o público vê): manutenção agendada que já
 * começou ou terminou pelo relógio conta como em andamento ou concluída.
 */

export type StatusIncidentActionResult<Field extends string> =
  | { ok: true; message: string }
  | { ok: false; error: string; fieldErrors?: Partial<Record<Field, string>> }

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const INVALID_ID_MESSAGE = "Registro inválido. Atualize a página."
const STALE_MESSAGE =
  "Este registro mudou desde que a página foi aberta (novo estado ou horário). Atualize a página e confira."

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function revalidateStatus() {
  revalidatePath(PLATFORM_STATUS_PATH)
  revalidatePath("/status")
  // Sem conteúdo velho: a página pública e a faixa do CRM leem o retrato novo já.
  revalidateTag(PUBLIC_STATUS_CACHE_TAG, { expire: 0 })
}

type StoredIncidentLookup =
  { ok: true; incident: StatusConsoleIncident } | { ok: false; error: string }

/** Relê o registro no banco (fonte da verdade para tipo, estado, impacto e partes). */
async function findStoredIncident(incidentId: string): Promise<StoredIncidentLookup> {
  const result = await listStatusIncidents()

  if (!result.ok) {
    return { ok: false, error: statusIncidentFailureMessage(result) }
  }

  const incident = result.data.find((entry) => entry.id === incidentId)

  return incident
    ? { ok: true, incident }
    : { ok: false, error: "Este registro não existe mais. Atualize a página." }
}

/** O navegador abriu o formulário com outro tipo ou estado do que está gravado agora? */
function isStaleContext(context: unknown, incident: StatusConsoleIncident): boolean {
  if (!isRecord(context)) {
    return false
  }

  const status = "currentStatus" in context ? context.currentStatus : context.status

  return context.kind !== incident.kind || status !== incident.effectiveStatus
}

export async function createIncidentAction(
  values: unknown
): Promise<StatusIncidentActionResult<IncidentCreateField>> {
  const admin = await getPlatformAdmin()

  if (!admin) {
    return { ok: false, error: PLATFORM_RPC_FAILURE_MESSAGES.sem_acesso }
  }

  if (!canAct(admin)) {
    return { ok: false, error: PLATFORM_READ_ONLY_MESSAGE }
  }

  const prepared = prepareIncidentCreate(isRecord(values) ? values : {}, new Date())

  if (!prepared.ok) {
    return { ok: false, error: "Confira os campos destacados.", fieldErrors: prepared.fieldErrors }
  }

  const result = await createStatusIncident(prepared.payload)

  if (!result.ok) {
    return { ok: false, error: statusIncidentFailureMessage(result) }
  }

  revalidateStatus()

  return {
    ok: true,
    message:
      prepared.payload.kind === "maintenance" ? "Manutenção agendada." : "Incidente publicado.",
  }
}

export async function addIncidentUpdateAction(
  incidentId: string,
  values: unknown,
  context: unknown
): Promise<StatusIncidentActionResult<IncidentUpdateField>> {
  const admin = await getPlatformAdmin()

  if (!admin) {
    return { ok: false, error: PLATFORM_RPC_FAILURE_MESSAGES.sem_acesso }
  }

  if (!canAct(admin)) {
    return { ok: false, error: PLATFORM_READ_ONLY_MESSAGE }
  }

  if (typeof incidentId !== "string" || !UUID_PATTERN.test(incidentId)) {
    return { ok: false, error: INVALID_ID_MESSAGE }
  }

  const stored = await findStoredIncident(incidentId)

  if (!stored.ok) {
    return { ok: false, error: stored.error }
  }

  const { incident } = stored
  const prepared = prepareIncidentUpdate(isRecord(values) ? values : {}, {
    kind: incident.kind,
    currentStatus: incident.effectiveStatus,
  })

  if (!prepared.ok) {
    return {
      ok: false,
      error: isStaleContext(context, incident) ? STALE_MESSAGE : "Confira os campos destacados.",
      fieldErrors: prepared.fieldErrors,
    }
  }

  const result = await addStatusIncidentUpdate(incident.id, prepared.payload)

  if (!result.ok) {
    return { ok: false, error: statusIncidentFailureMessage(result) }
  }

  revalidateStatus()

  const message =
    prepared.payload.status === "resolved"
      ? "Incidente resolvido."
      : prepared.payload.status === "completed"
        ? "Manutenção concluída."
        : "Atualização publicada."

  return { ok: true, message }
}

export async function editIncidentAction(
  incidentId: string,
  values: unknown,
  context: unknown
): Promise<StatusIncidentActionResult<IncidentEditField>> {
  const admin = await getPlatformAdmin()

  if (!admin) {
    return { ok: false, error: PLATFORM_RPC_FAILURE_MESSAGES.sem_acesso }
  }

  if (!canAct(admin)) {
    return { ok: false, error: PLATFORM_READ_ONLY_MESSAGE }
  }

  if (typeof incidentId !== "string" || !UUID_PATTERN.test(incidentId)) {
    return { ok: false, error: INVALID_ID_MESSAGE }
  }

  const stored = await findStoredIncident(incidentId)

  if (!stored.ok) {
    return { ok: false, error: stored.error }
  }

  const { incident } = stored
  const prepared = prepareIncidentEdit(
    isRecord(values) ? values : {},
    {
      kind: incident.kind,
      status: incident.effectiveStatus,
      impact: incident.impact,
      componentKeys: incident.componentKeys,
    },
    new Date()
  )

  if (!prepared.ok) {
    return {
      ok: false,
      error: isStaleContext(context, incident) ? STALE_MESSAGE : "Confira os campos destacados.",
      fieldErrors: prepared.fieldErrors,
    }
  }

  const result = await editStatusIncident(incident.id, prepared.payload)

  if (!result.ok) {
    return { ok: false, error: statusIncidentFailureMessage(result) }
  }

  revalidateStatus()

  return { ok: true, message: "Alterações salvas." }
}

/**
 * "Assumir" um incidente automático: a automação para de mexer nele (não
 * atualiza, não resolve, não reabre). Relê o registro para conferir que é
 * automático; o banco confere de novo.
 */
export async function takeOverIncidentAction(
  incidentId: string
): Promise<StatusIncidentActionResult<never>> {
  const admin = await getPlatformAdmin()

  if (!admin) {
    return { ok: false, error: PLATFORM_RPC_FAILURE_MESSAGES.sem_acesso }
  }

  if (!canAct(admin)) {
    return { ok: false, error: PLATFORM_READ_ONLY_MESSAGE }
  }

  if (typeof incidentId !== "string" || !UUID_PATTERN.test(incidentId)) {
    return { ok: false, error: INVALID_ID_MESSAGE }
  }

  const stored = await findStoredIncident(incidentId)

  if (!stored.ok) {
    return { ok: false, error: stored.error }
  }

  if (stored.incident.source !== "automatic") {
    return { ok: false, error: "Só incidente detectado automaticamente pode ser assumido." }
  }

  if (stored.incident.automationStoppedReason === "equipe") {
    return { ok: true, message: "Este incidente já estava com a equipe." }
  }

  const result = await takeOverStatusIncident(stored.incident.id)

  if (!result.ok) {
    return { ok: false, error: statusIncidentFailureMessage(result) }
  }

  revalidateStatus()

  return {
    ok: true,
    message:
      "Incidente assumido: a automação não mexe mais nele. Publique as próximas atualizações.",
  }
}

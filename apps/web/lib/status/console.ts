import "server-only"

import { z } from "zod"

import type {
  AutomationStopReason,
  IncidentSource,
  VendorIndicator,
} from "@workspace/core/status/automation"
import {
  BILLING_WEBHOOK_OUTCOMES,
  type BillingWebhookOutcome,
} from "@workspace/core/status/billing-webhook"
import type {
  AnyIncidentStatus,
  IncidentCreatePayload,
  IncidentEditPayload,
  IncidentKind,
  IncidentUpdatePayload,
} from "@workspace/core/status/incidents"
import type { IncidentImpact, StatusComponentKey, StatusLevel } from "@workspace/core/status/public"

import {
  PlatformRpcError,
  throwPlatformRpcError,
  withPlatformRpc,
  type PlatformRpcFailure,
  type PlatformRpcResult,
} from "@/lib/plataforma/rpc"

/**
 * Status público no Console da Plataforma (/plataforma/status): incidentes e
 * manutenções escritos pela equipe e as medições automáticas por parte.
 *
 * Mesmo contrato das outras telas do console: RPCs `platform_status_*` com a
 * chave do servidor, chamadas por `withPlatformRpc` (confere o administrador de
 * novo). Toda mudança grava o registro do console na mesma transação, dentro da
 * própria RPC; quem agiu vem da sessão, nunca do formulário.
 */

export const PLATFORM_STATUS_PATH = "/plataforma/status"

/** Resultado da última sonda HTTP ao app (/api/status/ping), só para o console. */
export const STATUS_PROBE_RESULTS = [
  "ok",
  "lento",
  "http_erro",
  "http_configuracao",
  "tempo_esgotado",
  "erro_conexao",
  "resposta_invalida",
  "sem_resposta",
  "sem_url",
  "falha_ao_enviar",
] as const

export type StatusProbeResult = (typeof STATUS_PROBE_RESULTS)[number]

export type StatusProbeState = {
  /** O segredo status_probe_url existe no Vault (com https)? */
  urlConfigured: boolean
  /** A rotina status-publico-medicoes existe e está ativa? null = não existe. */
  jobActive: boolean | null
  lastSentAt: string | null
  lastCheckedAt: string | null
  lastResult: StatusProbeResult | null
  lastHttpStatus: number | null
  lastDurationMs: number | null
}

export type StatusMeasurement = {
  measuredAt: string
  /** O que a medição viu agora. */
  measuredLevel: StatusLevel
  /** Nível automático depois da histerese; null antes do primeiro nível confirmado. */
  level: StatusLevel | null
  /** Código curto interno do motivo (ex.: http_503, fila_atrasada). Nunca vai ao público. */
  detail: string | null
}

/** Entrega do webhook da Stripe (só o resultado; nunca payload, ids ou valores). */
export type BillingWebhookDelivery = {
  receivedAt: string
  outcome: BillingWebhookOutcome
  /** Tipo do evento, só quando a assinatura conferiu. */
  eventType: string | null
}

/** Sinal automático de "Assinaturas e pagamentos": entregas do webhook da Stripe. */
export type BillingWebhookState = {
  lastReceivedAt: string | null
  lastOutcome: BillingWebhookOutcome | null
  lastEventType: string | null
  lastOkAt: string | null
  lastProblemAt: string | null
  lastProblemOutcome: BillingWebhookOutcome | null
  /** Entregas por resultado nas últimas 2 h (a janela da medição). */
  counts2h: Record<BillingWebhookOutcome, number>
  /** Até 10, da mais nova para a mais antiga (guardadas por 14 dias). */
  recent: BillingWebhookDelivery[]
}

export type StatusConsoleComponent = {
  key: StatusComponentKey
  /** automatic = há regra automática; manual = só incidente/manutenção. */
  source: "automatic" | "manual"
  /**
   * O sinal automático está ligado (segredo da sonda, rotina ativa, webhook de
   * avisos, entrega da Stripe em 14 dias)? false = a página pública diz
   * "acompanhado pela equipe". null = banco anterior à informação.
   */
  signalConfigured: boolean | null
  /** Só em billing: entregas do webhook da Stripe. null nas demais partes. */
  billingWebhook: BillingWebhookState | null
  /** Nível automático estável (histerese); null sem medição confirmada. */
  automaticLevel: StatusLevel | null
  /** Nível diferente esperando a 2ª medição igual para valer. */
  candidateLevel: StatusLevel | null
  candidateCount: number
  lastMeasuredAt: string | null
  lastDetail: string | null
  /** Quando o nível automático mudou pela última vez. */
  changedAt: string | null
  /** Medições mais recentes, da mais nova para a mais antiga. */
  recent: StatusMeasurement[]
}

/** Última passada da automação de incidentes (no banco, a cada minuto). */
export type StatusAutomationRun = {
  lastRunAt: string | null
  /** SQLSTATE do último erro (sem mensagem); null se nunca falhou. */
  lastError: string | null
  lastErrorAt: string | null
}

/** Situação pública de um fornecedor (API oficial de status), só sinal interno. */
export type StatusVendor = {
  key: string
  name: string
  enabled: boolean
  indicator: VendorIndicator | null
  /** Última leitura boa. */
  checkedAt: string | null
  lastResult: string | null
  lastAttemptAt: string | null
}

/** Fila do aviso por e-mail aos Donos. */
export type StatusAlertsQueue = {
  /** Os dois segredos do webhook existem no Vault? (nunca os valores) */
  webhookConfigured: boolean
  pending: number
  expiredLast7d: number
  emailsUsed24h: number
  emailsLimit: number
  lastSentAt: string | null
}

export type StatusConsoleOverview = {
  generatedAt: string
  probe: StatusProbeState
  components: StatusConsoleComponent[]
  automation: StatusAutomationRun
  vendors: StatusVendor[]
  alerts: StatusAlertsQueue
}

export type StatusConsoleIncidentUpdate = {
  id: number
  status: AnyIncidentStatus
  message: string
  createdAt: string
  /** Publicada pela automação (texto de modelo), não por alguém da equipe. */
  automatic: boolean
}

export type StatusConsoleIncident = {
  id: string
  kind: IncidentKind
  /** automatic = aberto pela automação da página de status; team = pela equipe. */
  source: IncidentSource
  title: string
  impact: IncidentImpact
  /** Estado gravado pela equipe. */
  status: AnyIncidentStatus
  /** Estado que o público vê (manutenção agendada anda sozinha pelo relógio). */
  effectiveStatus: AnyIncidentStatus
  componentKeys: StatusComponentKey[]
  startedAt: string
  /** Fim efetivo (inclui manutenção concluída pelo horário previsto). */
  resolvedAt: string | null
  scheduledFor: string | null
  scheduledUntil: string | null
  createdAt: string
  updatedAt: string
  /** Incidente automático: quando a automação parou de mexer nele (null = ainda conduz). */
  automationStoppedAt: string | null
  automationStoppedReason: AutomationStopReason | null
  /** Incidente automático em "monitorando": desde quando voltou ao normal. */
  autoMonitoringSince: string | null
  /** Automático em aberto sem medição recente em nenhuma parte: a automação não confirma a recuperação. */
  waitingMeasurement: boolean
  /** Da mais recente para a mais antiga. */
  updates: StatusConsoleIncidentUpdate[]
}

const levelSchema = z.enum([
  "operational",
  "degraded_performance",
  "partial_outage",
  "major_outage",
  "under_maintenance",
])
const componentKeySchema = z.enum([
  "crm",
  "login",
  "leads_capture",
  "lead_routing",
  "notifications",
  "integrations",
  "caixa_catalog",
  "billing",
])
const incidentStatusSchema = z.enum([
  "investigating",
  "identified",
  "monitoring",
  "resolved",
  "scheduled",
  "in_progress",
  "completed",
])

const billingWebhookOutcomeSchema = z.enum(BILLING_WEBHOOK_OUTCOMES)

const billingWebhookSchema = z.object({
  last_received_at: z.string().nullable(),
  last_outcome: billingWebhookOutcomeSchema.nullable(),
  last_event_type: z.string().nullable(),
  last_ok_at: z.string().nullable(),
  last_problem_at: z.string().nullable(),
  last_problem_outcome: billingWebhookOutcomeSchema.nullable(),
  counts_2h: z.object({
    ok: z.number().int().nonnegative(),
    config_ausente: z.number().int().nonnegative(),
    assinatura_invalida: z.number().int().nonnegative(),
    erro_processamento: z.number().int().nonnegative(),
  }),
  recent: z.array(
    z.object({
      received_at: z.string(),
      outcome: billingWebhookOutcomeSchema,
      event_type: z.string().nullable(),
    })
  ),
})

const overviewSchema = z.object({
  generated_at: z.string(),
  probe: z.object({
    url_configured: z.boolean(),
    job_active: z.boolean().nullable(),
    last_sent_at: z.string().nullable(),
    last_checked_at: z.string().nullable(),
    last_result: z.enum(STATUS_PROBE_RESULTS).nullable(),
    last_http_status: z.number().int().nullable(),
    last_duration_ms: z.number().int().nullable(),
  }),
  components: z.array(
    z.object({
      key: componentKeySchema,
      source: z.enum(["automatic", "manual"]),
      signal_configured: z.boolean().optional(),
      automatic_level: levelSchema.nullable(),
      candidate_level: levelSchema.nullable(),
      candidate_count: z.number().int().nonnegative(),
      last_measured_at: z.string().nullable(),
      last_detail: z.string().nullable(),
      changed_at: z.string().nullable(),
      recent: z.array(
        z.object({
          measured_at: z.string(),
          measured_level: levelSchema,
          level: levelSchema.nullable(),
          detail: z.string().nullable(),
        })
      ),
    })
  ),
  automation: z.object({
    last_run_at: z.string().nullable(),
    last_error: z.string().nullable(),
    last_error_at: z.string().nullable(),
  }),
  vendors: z.array(
    z.object({
      key: z.string(),
      name: z.string(),
      enabled: z.boolean(),
      indicator: z.enum(["none", "minor", "major", "critical"]).nullable(),
      checked_at: z.string().nullable(),
      last_result: z.string().nullable(),
      last_attempt_at: z.string().nullable(),
    })
  ),
  alerts: z.object({
    webhook_configured: z.boolean(),
    pending: z.number().int().nonnegative(),
    expired_last_7d: z.number().int().nonnegative(),
    emails_used_24h: z.number().int().nonnegative(),
    emails_limit: z.number().int().positive(),
    last_sent_at: z.string().nullable(),
  }),
  billing_webhook: billingWebhookSchema.nullable().optional(),
})

const incidentsSchema = z.array(
  z.object({
    id: z.string(),
    kind: z.enum(["incident", "maintenance"]),
    source: z.enum(["automatic", "team"]),
    title: z.string(),
    impact: z.enum(["none", "minor", "major", "critical"]),
    status: incidentStatusSchema,
    effective_status: incidentStatusSchema,
    component_keys: z.array(componentKeySchema),
    started_at: z.string(),
    resolved_at: z.string().nullable(),
    scheduled_for: z.string().nullable(),
    scheduled_until: z.string().nullable(),
    created_at: z.string(),
    updated_at: z.string(),
    automation_stopped_at: z.string().nullable(),
    automation_stopped_reason: z.enum(["equipe", "limite_de_atualizacoes"]).nullable(),
    auto_monitoring_since: z.string().nullable(),
    waiting_measurement: z.boolean(),
    updates: z.array(
      z.object({
        id: z.number().int(),
        status: incidentStatusSchema,
        message: z.string(),
        created_at: z.string(),
        automatic: z.boolean(),
      })
    ),
  })
)

/**
 * Medições automáticas, estado da sonda, automação, fornecedores e fila do
 * aviso por e-mail (`platform_status_overview`). `samplesPerComponent` baixo
 * (ex.: 1) serve para quem só quer o resumo.
 */
export async function getStatusConsoleOverview(
  samplesPerComponent = 15
): Promise<PlatformRpcResult<StatusConsoleOverview>> {
  const operation = "platform_status_overview"

  return withPlatformRpc(operation, async ({ supabase, serverKey }) => {
    const { data, error } = await supabase.rpc(operation, {
      p_server_key: serverKey,
      p_samples_per_component: samplesPerComponent,
    })

    if (error) {
      throwPlatformRpcError(operation, error)
    }

    const parsed = overviewSchema.safeParse(data)

    if (!parsed.success) {
      throw new PlatformRpcError(operation, null, "dados_invalidos")
    }

    const { probe, automation, alerts } = parsed.data
    const webhook = parsed.data.billing_webhook
    const billingWebhook: BillingWebhookState | null = webhook
      ? {
          lastReceivedAt: webhook.last_received_at,
          lastOutcome: webhook.last_outcome,
          lastEventType: webhook.last_event_type,
          lastOkAt: webhook.last_ok_at,
          lastProblemAt: webhook.last_problem_at,
          lastProblemOutcome: webhook.last_problem_outcome,
          counts2h: webhook.counts_2h,
          recent: webhook.recent.map((delivery) => ({
            receivedAt: delivery.received_at,
            outcome: delivery.outcome,
            eventType: delivery.event_type,
          })),
        }
      : null

    return {
      generatedAt: parsed.data.generated_at,
      probe: {
        urlConfigured: probe.url_configured,
        jobActive: probe.job_active,
        lastSentAt: probe.last_sent_at,
        lastCheckedAt: probe.last_checked_at,
        lastResult: probe.last_result,
        lastHttpStatus: probe.last_http_status,
        lastDurationMs: probe.last_duration_ms,
      },
      components: parsed.data.components.map((component) => ({
        key: component.key,
        source: component.source,
        signalConfigured: component.signal_configured ?? null,
        billingWebhook: component.key === "billing" ? billingWebhook : null,
        automaticLevel: component.automatic_level,
        candidateLevel: component.candidate_level,
        candidateCount: component.candidate_count,
        lastMeasuredAt: component.last_measured_at,
        lastDetail: component.last_detail,
        changedAt: component.changed_at,
        recent: component.recent.map((sample) => ({
          measuredAt: sample.measured_at,
          measuredLevel: sample.measured_level,
          level: sample.level,
          detail: sample.detail,
        })),
      })),
      automation: {
        lastRunAt: automation.last_run_at,
        lastError: automation.last_error,
        lastErrorAt: automation.last_error_at,
      },
      vendors: parsed.data.vendors.map((vendor) => ({
        key: vendor.key,
        name: vendor.name,
        enabled: vendor.enabled,
        indicator: vendor.indicator,
        checkedAt: vendor.checked_at,
        lastResult: vendor.last_result,
        lastAttemptAt: vendor.last_attempt_at,
      })),
      alerts: {
        webhookConfigured: alerts.webhook_configured,
        pending: alerts.pending,
        expiredLast7d: alerts.expired_last_7d,
        emailsUsed24h: alerts.emails_used_24h,
        emailsLimit: alerts.emails_limit,
        lastSentAt: alerts.last_sent_at,
      },
    }
  })
}

/** Incidentes e manutenções, do mais novo para o mais antigo (`platform_status_list_incidents`). */
export async function listStatusIncidents(): Promise<PlatformRpcResult<StatusConsoleIncident[]>> {
  const operation = "platform_status_list_incidents"

  return withPlatformRpc(operation, async ({ supabase, serverKey }) => {
    const { data, error } = await supabase.rpc(operation, {
      p_server_key: serverKey,
      p_limit: 100,
    })

    if (error) {
      throwPlatformRpcError(operation, error)
    }

    const parsed = incidentsSchema.safeParse(data)

    if (!parsed.success) {
      throw new PlatformRpcError(operation, null, "dados_invalidos")
    }

    return parsed.data.map((incident) => ({
      id: incident.id,
      kind: incident.kind,
      source: incident.source,
      title: incident.title,
      impact: incident.impact,
      status: incident.status,
      effectiveStatus: incident.effective_status,
      componentKeys: incident.component_keys,
      startedAt: incident.started_at,
      resolvedAt: incident.resolved_at,
      scheduledFor: incident.scheduled_for,
      scheduledUntil: incident.scheduled_until,
      createdAt: incident.created_at,
      updatedAt: incident.updated_at,
      automationStoppedAt: incident.automation_stopped_at,
      automationStoppedReason: incident.automation_stopped_reason,
      autoMonitoringSince: incident.auto_monitoring_since,
      waitingMeasurement: incident.waiting_measurement,
      updates: incident.updates.map((update) => ({
        id: update.id,
        status: update.status,
        message: update.message,
        createdAt: update.created_at,
        automatic: update.automatic,
      })),
    }))
  })
}

/** Cria incidente (com a primeira atualização) ou agenda manutenção. */
export async function createStatusIncident(
  payload: IncidentCreatePayload
): Promise<PlatformRpcResult<{ id: string }>> {
  const operation = "platform_status_create_incident"

  return withPlatformRpc(operation, async ({ supabase, serverKey, admin }) => {
    const { data, error } = await supabase.rpc(operation, {
      p_server_key: serverKey,
      p_actor_user_id: admin.id,
      p_actor_email: admin.email,
      p_kind: payload.kind,
      p_title: payload.title,
      p_impact: payload.impact,
      p_component_keys: payload.componentKeys,
      p_message: payload.message,
      p_status: payload.status ?? undefined,
      p_scheduled_for: payload.scheduledFor ?? undefined,
      p_scheduled_until: payload.scheduledUntil ?? undefined,
    })

    if (error) {
      throwPlatformRpcError(operation, error)
    }

    if (typeof data !== "string") {
      throw new PlatformRpcError(operation, null, "dados_invalidos")
    }

    return { id: data }
  })
}

/** Publica uma atualização (muda o estado; resolvido/concluída encerra). */
export async function addStatusIncidentUpdate(
  incidentId: string,
  payload: IncidentUpdatePayload
): Promise<PlatformRpcResult<{ id: number }>> {
  const operation = "platform_status_add_update"

  return withPlatformRpc(operation, async ({ supabase, serverKey, admin }) => {
    const { data, error } = await supabase.rpc(operation, {
      p_server_key: serverKey,
      p_actor_user_id: admin.id,
      p_actor_email: admin.email,
      p_incident_id: incidentId,
      p_status: payload.status,
      p_message: payload.message,
    })

    if (error) {
      throwPlatformRpcError(operation, error)
    }

    if (typeof data !== "number") {
      throw new PlatformRpcError(operation, null, "dados_invalidos")
    }

    return { id: data }
  })
}

/** Edita título, impacto e partes afetadas (e a janela da manutenção ainda agendada). */
export async function editStatusIncident(
  incidentId: string,
  payload: IncidentEditPayload
): Promise<PlatformRpcResult<{ id: string }>> {
  const operation = "platform_status_edit_incident"

  return withPlatformRpc(operation, async ({ supabase, serverKey, admin }) => {
    const { data, error } = await supabase.rpc(operation, {
      p_server_key: serverKey,
      p_actor_user_id: admin.id,
      p_actor_email: admin.email,
      p_incident_id: incidentId,
      p_title: payload.title,
      p_impact: payload.impact,
      p_component_keys: payload.componentKeys,
      p_scheduled_for: payload.scheduledFor ?? undefined,
      p_scheduled_until: payload.scheduledUntil ?? undefined,
    })

    if (error) {
      throwPlatformRpcError(operation, error)
    }

    if (typeof data !== "string") {
      throw new PlatformRpcError(operation, null, "dados_invalidos")
    }

    return { id: data }
  })
}

/**
 * Marca um incidente automático como assumido pela equipe: a automação não
 * abre, atualiza, resolve nem reabre mais esse incidente.
 */
export async function takeOverStatusIncident(
  incidentId: string
): Promise<PlatformRpcResult<{ id: string }>> {
  const operation = "platform_status_take_over"

  return withPlatformRpc(operation, async ({ supabase, serverKey, admin }) => {
    const { data, error } = await supabase.rpc(operation, {
      p_server_key: serverKey,
      p_actor_user_id: admin.id,
      p_actor_email: admin.email,
      p_incident_id: incidentId,
    })

    if (error) {
      throwPlatformRpcError(operation, error)
    }

    if (typeof data !== "string") {
      throw new PlatformRpcError(operation, null, "dados_invalidos")
    }

    return { id: data }
  })
}

/** Frase para a tela a partir do código do banco (sem o texto do erro). */
export function statusIncidentFailureMessage(failure: PlatformRpcFailure): string {
  switch (failure.code) {
    case "22023":
      return "O registro já foi encerrado, o estado não vale para este tipo ou a janela da manutenção é inválida. Atualize a página e confira."
    case "P0002":
      return "Este registro não existe mais. Atualize a página."
    case "23514":
      return "Algum campo está fora das regras (título, mensagem, partes ou horários). Confira e tente de novo."
    default:
      return failure.message
  }
}

/**
 * Console da Plataforma — filas de envio (só contagens).
 *
 * `platform_health().queues` devolve, por fila: pendentes, antigos (pendentes
 * há mais de `stale_after_minutes`), com erro e o horário do pendente mais
 * antigo. Nenhum dado de lead, cliente ou corretor sai do banco.
 */

import { describeAge, formatDurationMinutes, pluralize, type HealthItem } from "./health"

export const PLATFORM_QUEUE_KEYS = [
  "avisos_de_lead",
  "alertas_de_autorizacao",
  "lembretes_de_visita",
  "resumos_diarios",
  "relatorios_semanais",
  "push_de_avisos",
  "entrada_de_leads",
] as const

export type PlatformQueueKey = (typeof PLATFORM_QUEUE_KEYS)[number]

export type PlatformQueueCounts = {
  pending: number
  stale: number
  failed: number
  oldestPendingAt: string | null
  staleAfterMinutes: number | null
  /** Só em push_de_avisos: aparelhos com avisos ligados. */
  devices?: number
}

type QueueSpec = {
  label: string
  reference: string
  /** O que fazer quando há itens antigos. */
  staleAction: string
  /** O que fazer quando há itens com erro. */
  failedAction: string
  /** Palavra para "com erro" nessa fila. */
  failedLabel: string
}

const QUEUE_SPECS: Record<PlatformQueueKey, QueueSpec> = {
  avisos_de_lead: {
    label: "Avisos de lead por e-mail",
    reference: "private.lead_notifications",
    staleAction:
      "Configure o webhook dos avisos de lead no Vault (lead_alerts_webhook_url e _secret) e confira a BREVO_API_KEY; a rotina diária /api/cron/lead-alerts drena o que sobrar.",
    failedAction:
      "Os avisos com 5 tentativas não voltam para a fila. Confira a Brevo (limite diário e chave) e os logs da rota /api/cron/lead-alerts.",
    failedLabel: "desistidos após 5 tentativas",
  },
  alertas_de_autorizacao: {
    label: "Avisos de autorização vencendo",
    reference: "private.authorization_alert_notifications",
    staleAction:
      "A rotina diária /api/cron/authorization-alerts deveria ter enviado. Confira CRON_SECRET e os logs da rota na Vercel.",
    failedAction:
      "Confira a Brevo (limite diário e chave) e os logs de /api/cron/authorization-alerts.",
    failedLabel: "desistidos após 5 tentativas",
  },
  lembretes_de_visita: {
    label: "Lembretes de visita",
    reference: "private.visit_reminder_notifications",
    staleAction:
      "Configure o webhook dos lembretes de visita no Vault (visit_reminders_webhook_url e _secret): sem ele a fila não é drenada.",
    failedAction:
      "Lembretes perdidos (visita já passou ou 5 tentativas). Confira o webhook no Vault e a Brevo.",
    failedLabel: "perdidos nos últimos 7 dias",
  },
  resumos_diarios: {
    label: "Resumos diários",
    reference: "private.daily_digest_deliveries",
    staleAction:
      "Confira os logs de /api/cron/daily-digest na Vercel; o resumo sai uma vez por dia.",
    failedAction: "Confira a Brevo (limite diário e chave) e os logs da rota.",
    failedLabel: "desistidos após 5 tentativas",
  },
  relatorios_semanais: {
    label: "Relatórios semanais",
    reference: "private.weekly_report_deliveries",
    staleAction: "Confira os logs de /api/cron/weekly-report na Vercel (roda às segundas).",
    failedAction: "Confira a Brevo (limite diário e chave) e os logs da rota.",
    failedLabel: "desistidos após 5 tentativas",
  },
  push_de_avisos: {
    label: "Avisos no celular (push)",
    reference: "private.lead_notifications.push_sent_at",
    staleAction:
      "O e-mail saiu e o push não: confira as chaves VAPID (NEXT_PUBLIC_VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY e VAPID_SUBJECT).",
    failedAction: "Confira as chaves VAPID e os logs de /api/cron/lead-alerts.",
    failedLabel: "com erro",
  },
  entrada_de_leads: {
    label: "Entrada de leads de portais e anúncios",
    reference: "public.lead_integration_deliveries",
    staleAction:
      "Confira LEAD_INGEST_SERVER_KEY, os segredos lead_ingest_webhook_url e _secret no Vault (sem eles a nova tentativa só roda 1 vez por dia, na rotina da Vercel) e os logs de /api/cron/lead-ingest.",
    failedAction:
      "Entregas com falha são tentadas de novo. Se não baixarem, confira o token da Página da imobiliária e LEAD_INGEST_SERVER_KEY.",
    failedLabel: "com falha, aguardando nova tentativa",
  },
}

function count(value: number): number {
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0
}

/** Estado de uma fila. */
export function evaluateQueue(
  key: PlatformQueueKey,
  counts: PlatformQueueCounts,
  now: Date
): HealthItem {
  const spec = QUEUE_SPECS[key]
  const pending = count(counts.pending)
  const stale = count(counts.stale)
  const failed = count(counts.failed)
  const base = { key: `fila_${key}`, label: spec.label, reference: spec.reference }

  if (key === "push_de_avisos") {
    const devices = count(counts.devices ?? 0)
    const devicesText = pluralize(
      devices,
      "aparelho com avisos ligados",
      "aparelhos com avisos ligados"
    )

    if (stale > 0) {
      return {
        ...base,
        status: "atencao",
        detail: `${pluralize(stale, "aviso das últimas 24 h saiu", "avisos das últimas 24 h saíram")} por e-mail sem push · ${devicesText}.`,
        action: spec.staleAction,
      }
    }

    return {
      ...base,
      status: "ok",
      detail: `${pluralize(pending, "aviso aguardando", "avisos aguardando")} · ${devicesText}.`,
      action: null,
    }
  }

  const oldest =
    pending > 0 && counts.oldestPendingAt
      ? ` · o mais antigo entrou ${describeAge(counts.oldestPendingAt, now)}`
      : ""
  const pendingText = `${pluralize(pending, "pendente", "pendentes")}${oldest}`

  if (failed > 0) {
    return {
      ...base,
      status: key === "entrada_de_leads" && stale === 0 ? "atencao" : "problema",
      detail: `${pluralize(failed, "item", "itens")} ${spec.failedLabel} · ${pendingText}.`,
      action: spec.failedAction,
    }
  }

  if (stale > 0) {
    const limit =
      counts.staleAfterMinutes !== null && counts.staleAfterMinutes > 0
        ? ` há mais de ${formatDurationMinutes(counts.staleAfterMinutes)}`
        : ""
    return {
      ...base,
      status: "atencao",
      detail: `${pluralize(stale, "item parado", "itens parados")}${limit} · ${pendingText}.`,
      action: spec.staleAction,
    }
  }

  return {
    ...base,
    status: "ok",
    detail: pending > 0 ? `${pendingText}, dentro do prazo.` : "Nada pendente.",
    action: null,
  }
}

/** Itens de todas as filas conhecidas; fila ausente na resposta é ignorada. */
export function evaluateQueues(
  queues: Partial<Record<PlatformQueueKey, PlatformQueueCounts>>,
  now: Date
): HealthItem[] {
  return PLATFORM_QUEUE_KEYS.flatMap((key) => {
    const counts = queues[key]
    return counts ? [evaluateQueue(key, counts, now)] : []
  })
}

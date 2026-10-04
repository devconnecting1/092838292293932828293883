/**
 * Página de status — sinal automático de "Assinaturas e pagamentos" pelas
 * entregas do webhook da Stripe (/api/webhooks/stripe).
 *
 * A rota grava só o RESULTADO de cada entrega (instante, resultado e tipo do
 * evento verificado) por `record_billing_webhook_delivery`; o banco mede a
 * parte a cada minuto com `private.status_billing_webhook_signal` (migração
 * status_page_billing_webhook_signal). Aqui ficam o espelho puro dessa regra
 * (para testar e explicar no Console), os rótulos em pt-BR e as checagens que
 * a rota faz antes de gravar. Mudou aqui, mude lá (e vice-versa).
 *
 * Stripe: cabeçalho `Stripe-Signature` no formato `t=...,v1=...`; nova
 * assinatura e novo carimbo de data e hora a cada tentativa; tolerância padrão
 * de 5 min nas bibliotecas (https://docs.stripe.com/webhooks).
 */

import type { MeasuredStatusLevel } from "./levels"

export const BILLING_WEBHOOK_OUTCOMES = [
  "ok",
  "config_ausente",
  "assinatura_invalida",
  "erro_processamento",
] as const

export type BillingWebhookOutcome = (typeof BILLING_WEBHOOK_OUTCOMES)[number]

/** Números da regra (iguais aos do banco). */
export const BILLING_WEBHOOK_RULES = {
  /** Janela da medição. */
  windowMinutes: 120,
  /** Entregas processadas (ok + erro_processamento) mínimas para medir a proporção de erro. */
  minProcessedForErrorRate: 3,
  /** Dias que as entregas ficam guardadas (e que mantêm o sinal "ligado"). */
  retentionDays: 14,
  /** Idade máxima do carimbo `t=` do cabeçalho para contar como entrega da Stripe. */
  signatureToleranceSeconds: 300,
  /** A mesma falha de configuração em rajada grava no máximo uma vez nesse intervalo. */
  repeatedProblemSeconds: 10,
} as const

/** O que aconteceu com a entrega, para o Console. */
export const BILLING_WEBHOOK_OUTCOME_LABELS: Record<BillingWebhookOutcome, string> = {
  ok: "Recebida e processada",
  config_ausente: "Recusada: chave da Stripe ou segredo do webhook ausente no servidor",
  assinatura_invalida: "Recusada: assinatura não confere com o segredo do webhook",
  erro_processamento: "Recebida, mas a sincronização falhou",
}

/** Resultado curto para listas e badges. */
export const BILLING_WEBHOOK_OUTCOME_SHORT_LABELS: Record<BillingWebhookOutcome, string> = {
  ok: "Processada",
  config_ausente: "Configuração ausente",
  assinatura_invalida: "Assinatura inválida",
  erro_processamento: "Erro ao processar",
}

/** O que fazer quando a última entrega falhou (null quando não há nada a fazer). */
export const BILLING_WEBHOOK_ACTIONS: Record<BillingWebhookOutcome, string | null> = {
  ok: null,
  config_ausente:
    "Confira STRIPE_WEBHOOK_SECRET na Vercel (e STRIPE_SECRET_KEY): sem os dois, o webhook recusa as entregas e as assinaturas não sincronizam. Depois de salvar, faça um novo deploy.",
  assinatura_invalida:
    "Confira STRIPE_WEBHOOK_SECRET na Vercel: precisa ser o whsec_ do endpoint cadastrado na Stripe (teste e produção têm segredos diferentes). Depois de salvar, faça um novo deploy.",
  erro_processamento:
    "Veja os logs da Vercel com [billing/webhook] para a causa. A Stripe reenvia as falhas temporárias sozinha.",
}

/** Falha de configuração (segredo ausente ou errado), que pede ação na Vercel. */
export function isBillingWebhookConfigProblem(outcome: BillingWebhookOutcome | null | undefined) {
  return outcome === "config_ausente" || outcome === "assinatura_invalida"
}

export function isBillingWebhookOutcome(value: unknown): value is BillingWebhookOutcome {
  return (
    typeof value === "string" && (BILLING_WEBHOOK_OUTCOMES as readonly string[]).includes(value)
  )
}

const EVENT_TYPE_PATTERN = /^[a-z0-9_]+(\.[a-z0-9_]+)+$/

/** Tipo de evento no formato da Stripe (ex.: invoice.paid), igual ao aceito pelo banco. */
export function isStripeEventType(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length >= 3 &&
    value.length <= 80 &&
    EVENT_TYPE_PATTERN.test(value)
  )
}

/**
 * O cabeçalho `Stripe-Signature` tem a cara de uma entrega da Stripe feita
 * agora? (`t=` com carimbo a até 5 min do relógio e ao menos um `v1=` de 64
 * caracteres hexadecimais.) Não prova a origem — só a assinatura prova —, mas
 * separa robôs e reenvios velhos de uma entrega real com segredo ausente ou
 * errado, que é o que a medição quer contar.
 */
export function isFreshStripeSignatureHeader(
  header: string | null | undefined,
  nowMs: number
): boolean {
  if (!header || header.length > 2048) {
    return false
  }

  let timestamp: number | null = null
  let hasV1 = false

  for (const item of header.split(",")) {
    const separator = item.indexOf("=")

    if (separator <= 0) {
      continue
    }

    const prefix = item.slice(0, separator).trim()
    const value = item.slice(separator + 1).trim()

    if (prefix === "t" && /^\d{1,12}$/.test(value)) {
      timestamp = Number(value)
    } else if (prefix === "v1" && /^[0-9a-f]{64}$/.test(value)) {
      hasV1 = true
    }
  }

  if (timestamp === null || !hasV1 || !Number.isFinite(nowMs)) {
    return false
  }

  return Math.abs(nowMs / 1000 - timestamp) <= BILLING_WEBHOOK_RULES.signatureToleranceSeconds
}

export type BillingWebhookDelivery = {
  receivedAt: string | number | Date
  outcome: BillingWebhookOutcome
}

export type BillingWebhookSignal = {
  level: Extract<MeasuredStatusLevel, "operational" | "degraded_performance" | "partial_outage">
  detail:
    "ok" | "webhook_config_ausente" | "webhook_assinatura_invalida" | "webhook_erros_processamento"
}

function timeOf(value: BillingWebhookDelivery["receivedAt"]): number {
  return value instanceof Date ? value.getTime() : new Date(value).getTime()
}

/**
 * Espelho de `private.status_billing_webhook_signal`: entregas das últimas 2 h
 * (até `now`), na ordem em que foram gravadas.
 * - config_ausente ou assinatura_invalida sem nenhuma ok depois → instabilidade parcial;
 * - 3 ou mais processadas (ok + erro_processamento) e mais da metade com erro → lentidão;
 * - senão operacional;
 * - nenhuma entrega na janela → null (sem medição, nunca queda).
 */
export function billingWebhookSignal(
  deliveries: readonly BillingWebhookDelivery[],
  now: Date
): BillingWebhookSignal | null {
  const end = now.getTime()
  const start = end - BILLING_WEBHOOK_RULES.windowMinutes * 60_000

  // Ordem de gravação: instante e, no empate, a posição na lista (igual ao id).
  const inWindow = deliveries
    .map((delivery, index) => ({ ...delivery, at: timeOf(delivery.receivedAt), index }))
    .filter((delivery) => Number.isFinite(delivery.at) && delivery.at > start && delivery.at <= end)
    .sort((a, b) => a.at - b.at || a.index - b.index)

  if (inWindow.length === 0) {
    return null
  }

  let lastProblem: BillingWebhookOutcome | null = null

  for (const delivery of inWindow) {
    if (delivery.outcome === "ok") {
      lastProblem = null
    } else if (isBillingWebhookConfigProblem(delivery.outcome)) {
      lastProblem = delivery.outcome
    }
  }

  if (lastProblem === "config_ausente") {
    return { level: "partial_outage", detail: "webhook_config_ausente" }
  }

  if (lastProblem === "assinatura_invalida") {
    return { level: "partial_outage", detail: "webhook_assinatura_invalida" }
  }

  const processed = inWindow.filter(
    (delivery) => delivery.outcome === "ok" || delivery.outcome === "erro_processamento"
  ).length
  const errors = inWindow.filter((delivery) => delivery.outcome === "erro_processamento").length

  if (processed >= BILLING_WEBHOOK_RULES.minProcessedForErrorRate && errors * 2 > processed) {
    return { level: "degraded_performance", detail: "webhook_erros_processamento" }
  }

  return { level: "operational", detail: "ok" }
}

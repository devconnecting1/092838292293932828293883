import { AI_MAX_INPUT_TOKENS, AI_RATE_LIMIT, formatBRL, formatLimit } from "@workspace/core/billing"

import type { AiBlockContext } from "@/lib/ai/types"
import { formatDate } from "@/lib/format"

// Mensagens de bloqueio da IA em pt-BR. Puro (sem server-only): a tela e as
// Server Actions usam as mesmas frases. Toda mensagem diz o que aconteceu,
// quanto falta para a franquia virar e qual é a saída.

const DAY_MS = 24 * 60 * 60 * 1000

/** Dias inteiros até a data (arredonda para cima); null sem data válida. */
export function daysUntil(value: string | null, now = new Date()): number | null {
  if (!value) {
    return null
  }

  const time = new Date(value).getTime()
  return Number.isNaN(time) ? null : Math.max(0, Math.ceil((time - now.getTime()) / DAY_MS))
}

/** "em 12 dias (05/10/2026)" — vazio quando não há data de virada conhecida. */
export function describeRenewal(periodEnd: string | null, now = new Date()): string {
  const days = daysUntil(periodEnd, now)

  if (days === null) {
    return ""
  }

  const date = formatDate(periodEnd)

  if (days === 0) {
    return `hoje (${date})`
  }

  return days === 1 ? `amanhã (${date})` : `em ${days} dias (${date})`
}

const OVERAGE_HINT =
  "Para continuar agora, defina um teto de excedente em reais em Configurações › Assinatura."

/** Frase pronta para o usuário, explicando o corte e a saída. */
export function describeAiBlock(context: AiBlockContext, now = new Date()): string {
  const renewal = describeRenewal(context.periodEnd, now)
  const backIn = renewal ? ` A franquia volta ${renewal}.` : ""

  switch (context.reason) {
    case "billing_blocked":
      return "A IA fica pausada enquanto a assinatura não está em dia. Regularize o pagamento em Configurações › Assinatura para voltar a usar."
    case "feature_unavailable":
      return "O seu plano não inclui conversas de IA. Veja os planos com IA em Configurações › Assinatura."
    case "request_too_large":
      return `Esta conversa ficou longa demais para a IA responder de uma vez (limite de ${formatLimit(AI_MAX_INPUT_TOKENS)} tokens por pedido). Resuma o histórico e tente de novo.`
    case "rate_limited_organization":
      return `Muitos pedidos de IA ao mesmo tempo nesta imobiliária (limite de ${AI_RATE_LIMIT.perOrganizationPerMinute} por minuto). Espere um minuto e tente de novo.`
    case "rate_limited_user":
      return `Você fez muitos pedidos de IA em menos de um minuto (limite de ${AI_RATE_LIMIT.perUserPerMinute}). Espere um pouco e tente de novo.`
    case "daily_cost_cap":
      return `O limite de IA de hoje (${formatBRL(context.dayCapCents)}) foi atingido. A IA volta amanhã; o limite do dia existe para o consumo do mês não acabar de uma vez.`
    case "weekly_cost_cap":
      return `O limite de IA desta semana (${formatBRL(context.weekCapCents)}) foi atingido. A IA volta na semana que vem; o limite semanal existe para o consumo do mês não acabar de uma vez.`
    case "cycle_cost_cap":
      return `O limite de IA deste ciclo (${formatBRL(context.planCapCents)}) acabou.${backIn} ${OVERAGE_HINT}`
    case "quota_exhausted":
      return `As ${formatLimit(context.conversationsLimit)} conversas de IA do plano acabaram.${backIn} ${OVERAGE_HINT}`
    case "overage_cap":
      return `O teto de excedente de IA definido pela imobiliária (${formatBRL(context.overageCapCents)}) acabou.${backIn} Para continuar agora, aumente o teto em Configurações › Assinatura ou mude de plano.`
  }
}

/** Aviso (não bloqueio) quando a chamada já está sendo paga pelo excedente. */
export function describeAiOverage(context: Pick<AiBlockContext, "overageCapCents">): string {
  return `A franquia de IA do plano acabou: esta resposta está sendo paga pelo excedente autorizado (${formatBRL(context.overageCapCents)} por ciclo).`
}

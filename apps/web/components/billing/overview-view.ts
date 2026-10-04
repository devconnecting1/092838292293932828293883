// Textos e cálculos de exibição do resumo de assinatura (BillingOverview).
// Puro (sem server-only): os componentes de cliente também usam.
import {
  GRACE_DAYS,
  PLANS,
  planHasFeature,
  type BillingPlanKey,
  type BillingState,
  type FeatureKey,
} from "@workspace/core/billing"

import { pluralize } from "@/components/billing/plan-content"
import type { BillingOverview } from "@/lib/billing/queries"
import { formatDate } from "@/lib/format"

export const BILLING_STATE_LABELS: Record<BillingState, string> = {
  trialing: "Em teste",
  active: "Ativa",
  grace: "Pagamento pendente",
  read_only: "Modo leitura",
}

export const BILLING_STATE_BADGE_VARIANTS: Record<
  BillingState,
  "default" | "secondary" | "destructive" | "outline"
> = {
  trialing: "secondary",
  active: "default",
  grace: "destructive",
  read_only: "destructive",
}

export function planDisplayName(planKey: BillingPlanKey) {
  return planKey === "trial" ? "Teste grátis" : PLANS[planKey].name
}

/** Carência vinda do fim do teste (e não de um pagamento em atraso). */
export function isTrialOrigin(overview: BillingOverview) {
  return !overview.hasSubscription
}

const DAY_MS = 24 * 60 * 60 * 1000

function toTime(value: string | null) {
  if (!value) return null
  const time = new Date(value).getTime()
  return Number.isNaN(time) ? null : time
}

/** Dias inteiros até a data (arredonda para cima); null sem data válida. */
export function daysUntil(value: string | null, now = new Date()): number | null {
  const time = toTime(value)
  return time === null ? null : Math.ceil((time - now.getTime()) / DAY_MS)
}

/** Fim da carência: fim do teste (ou do período pago) + GRACE_DAYS. */
export function graceDeadline(overview: BillingOverview): Date | null {
  const base = toTime(isTrialOrigin(overview) ? overview.trialEndsAt : overview.currentPeriodEnd)
  return base === null ? null : new Date(base + GRACE_DAYS * DAY_MS)
}

export function overviewHasFeature(overview: BillingOverview, feature: FeatureKey) {
  return overview.features.length > 0
    ? overview.features.includes(feature)
    : planHasFeature(overview.planKey, feature)
}

/** Checkout concluído e confirmado pelo webhook (não pelo redirect). */
export function isSubscriptionConfirmed(overview: BillingOverview | null) {
  return overview !== null && overview.hasSubscription && overview.state === "active"
}

export type BillingStateMessage = { title: string; description: string }

/** Título e explicação do estado, usados no banner e na página de assinatura. */
export function describeBillingState(
  overview: BillingOverview,
  now = new Date()
): BillingStateMessage {
  // Bloqueio da plataforma vem como read_only, mas não se resolve assinando.
  if (overview.platformBlocked) {
    return {
      title: "Conta suspensa pela plataforma",
      description:
        "Nada foi apagado: você ainda vê e exporta tudo. Criar, editar, usar a IA e enviar mensagens pelas conexões estão pausados. Fale com o suporte para entender o motivo e liberar a conta.",
    }
  }

  switch (overview.state) {
    case "trialing": {
      const days = daysUntil(overview.trialEndsAt, now)

      return {
        title:
          days === null
            ? "Teste grátis em andamento"
            : days <= 0
              ? "Seu teste termina hoje"
              : `${days === 1 ? "Falta" : "Faltam"} ${pluralize(days, "dia", "dias")} de teste`,
        description: `Você está testando com os recursos do plano Equipe até ${formatDate(
          overview.trialEndsAt
        )}. Assine para continuar sem interrupção; nada do que você cadastrou é apagado.`,
      }
    }
    case "grace": {
      const deadline = formatDate(graceDeadline(overview))

      return isTrialOrigin(overview)
        ? {
            title: "Seu teste terminou",
            description: `O acesso continua completo até ${deadline}. Depois, a conta entra em modo leitura até você assinar um plano.`,
          }
        : {
            title: "Pagamento pendente",
            description: `Não conseguimos confirmar o último pagamento. O acesso continua completo até ${deadline}; depois, a conta entra em modo leitura. Atualize a forma de pagamento para evitar isso.`,
          }
    }
    case "read_only":
      return {
        title: "Conta em modo leitura",
        description:
          "Você ainda vê e exporta tudo, e as landing pages continuam captando leads. Para voltar a criar e editar, assine um plano.",
      }
    case "active":
      return {
        title: overview.cancelAtPeriodEnd ? "Assinatura cancelada" : "Assinatura ativa",
        description: overview.cancelAtPeriodEnd
          ? `O acesso continua até ${formatDate(overview.currentPeriodEnd)}. Depois disso, a conta entra em modo leitura, sem apagar nada.`
          : `Renova em ${formatDate(overview.currentPeriodEnd)}.`,
      }
  }
}

/** Mensagem do banner global: teste com até 3 dias, carência ou modo leitura. */
export function getBannerMessage(overview: BillingOverview): BillingStateMessage | null {
  const now = new Date()

  if (overview.state === "trialing") {
    const days = daysUntil(overview.trialEndsAt, now)
    return days !== null && days <= 3 ? describeBillingState(overview, now) : null
  }

  return overview.state === "grace" || overview.state === "read_only"
    ? describeBillingState(overview, now)
    : null
}

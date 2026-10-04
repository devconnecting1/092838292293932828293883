/**
 * Console da Plataforma — assinaturas (Stripe), só contagens.
 *
 * O modo (teste ou produção) sai do prefixo de STRIPE_SECRET_KEY, sem mostrar a
 * chave; as contagens por status da Stripe e por situação de acesso saem de
 * `platform_health().billing`. Nada de nome, e-mail ou valor por imobiliária.
 */

import type { BillingState } from "../billing/state"
import type { StripeKeyMode } from "./env"
import { pluralize, type HealthItem } from "./health"

export type PlatformBillingCounts = {
  organizations: number
  accounts: number
  withCustomer: number
  withSubscription: number
  /** status da Stripe espelhado em billing_accounts → quantidade. */
  byStatus: Record<string, number>
  /** situação de acesso (private.billing_state_at) → quantidade. */
  byState: Record<string, number>
}

/** Status da Stripe em pt-BR (valores aceitos em billing_accounts.status). */
export const STRIPE_STATUS_LABELS: Record<string, [singular: string, plural: string]> = {
  trialing: ["em teste", "em teste"],
  active: ["ativa", "ativas"],
  past_due: ["com pagamento atrasado", "com pagamento atrasado"],
  unpaid: ["não paga", "não pagas"],
  incomplete: ["incompleta", "incompletas"],
  incomplete_expired: ["incompleta expirada", "incompletas expiradas"],
  canceled: ["cancelada", "canceladas"],
  paused: ["pausada", "pausadas"],
}

/** Situação de acesso em pt-BR, para contagem ("2 em teste grátis"). */
const STATE_COUNT_LABELS: Record<BillingState, [singular: string, plural: string]> = {
  trialing: ["em teste grátis", "em teste grátis"],
  active: ["ativa", "ativas"],
  grace: ["em carência", "em carência"],
  read_only: ["em somente leitura", "em somente leitura"],
}

const STATE_ORDER: readonly BillingState[] = ["trialing", "active", "grace", "read_only"]

function count(value: number | undefined): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0
}

/** Estado do modo da Stripe (card de assinaturas). */
export function evaluateStripeMode(mode: StripeKeyMode | null): HealthItem {
  const base = { key: "assinaturas_modo", label: "Modo da Stripe", reference: "STRIPE_SECRET_KEY" }

  switch (mode) {
    case null:
      return {
        ...base,
        status: "atencao",
        detail: "Pagamentos não configurados: ninguém consegue assinar pelo app.",
        action:
          "Defina STRIPE_SECRET_KEY e STRIPE_WEBHOOK_SECRET na Vercel (veja apps/web/.env.example).",
      }
    case "desconhecido":
      return {
        ...base,
        status: "problema",
        detail: "A chave definida não tem formato de chave da Stripe.",
        action: "Use a chave restrita (rk_test_... ou rk_live_...) criada no painel da Stripe.",
      }
    case "teste":
      return {
        ...base,
        status: "ok",
        detail: "Modo teste: assinaturas e cobranças são simuladas pela Stripe.",
        action: null,
      }
    case "producao":
      return {
        ...base,
        status: "ok",
        detail: "Modo produção: as cobranças são reais.",
        action: null,
      }
  }
}

/** Itens de saúde das assinaturas. */
export function evaluateBilling(counts: PlatformBillingCounts): HealthItem[] {
  const states = STATE_ORDER.map((state) => {
    const [singular, plural] = STATE_COUNT_LABELS[state]
    return pluralize(count(counts.byState[state]), singular, plural)
  }).join(" · ")
  const grace = count(counts.byState.grace)

  const statusParts = Object.entries(counts.byStatus)
    .filter(([, total]) => count(total) > 0)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([status, total]) => {
      const labels = STRIPE_STATUS_LABELS[status]
      return labels ? pluralize(count(total), labels[0], labels[1]) : `${count(total)} ${status}`
    })

  const items: HealthItem[] = [
    {
      key: "assinaturas_situacao",
      label: "Contas por situação de acesso",
      reference: "billing_accounts",
      status: grace > 0 ? "atencao" : "ok",
      detail: `${states}.`,
      action:
        grace > 0
          ? `${pluralize(grace, "imobiliária está", "imobiliárias estão")} em carência (pagamento pendente): acompanhe em Assinaturas e receita.`
          : null,
    },
    {
      key: "assinaturas_status_stripe",
      label: "Contas por status na Stripe",
      reference: "billing_accounts.status",
      status: "ok",
      detail:
        `${statusParts.length > 0 ? statusParts.join(" · ") : "Nenhuma conta"} · ` +
        `${pluralize(count(counts.withSubscription), "com assinatura na Stripe", "com assinatura na Stripe")} · ` +
        `${pluralize(count(counts.withCustomer), "cliente na Stripe", "clientes na Stripe")}.`,
      action: null,
    },
  ]

  const withoutAccount = count(counts.organizations) - count(counts.accounts)

  if (withoutAccount > 0) {
    items.push({
      key: "assinaturas_sem_conta",
      label: "Imobiliárias sem conta de assinatura",
      reference: "billing_accounts",
      status: "problema",
      detail: `${pluralize(withoutAccount, "imobiliária sem", "imobiliárias sem")} conta de assinatura: ${withoutAccount === 1 ? "fica" : "ficam"} em somente leitura.`,
      action:
        "Toda imobiliária nova ganha o teste grátis pelo gatilho organizations_create_billing_account; rode select private.backfill_billing_accounts(); no SQL Editor.",
    })
  }

  return items
}

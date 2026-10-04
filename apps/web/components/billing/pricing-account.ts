// Conta conectada em /planos (versão com login). Só tipos e regras puras: o
// servidor monta em pricing-account-data.ts e os componentes de cliente leem.
import {
  isPlanKey,
  PLANS,
  type BillingInterval,
  type BillingPlanKey,
  type BillingState,
  type PlanKey,
} from "@workspace/core/billing"

import type { CheckoutReturnStatus } from "@/components/billing/checkout-return-notice"
import type { TenancyMode } from "@/lib/tenant/urls"

export type PricingOrganization = {
  id: string
  name: string
  roleLabel: string
  /** /planos com esta imobiliária escolhida (modo subdomain); null no host único. */
  plansHref: string | null
}

/** Resumo da assinatura da imobiliária escolhida (só o que a página usa). */
export type PricingBilling = {
  planKey: BillingPlanKey
  interval: BillingInterval | null
  seats: number
  /** Pacotes de +10 imóveis contratados hoje. */
  ownedListingPacks: number
  /** Membros ativos + convites pendentes: a nova assinatura não pode ficar abaixo. */
  usersInUse: number
  currentPeriodEnd: string | null
  hasSubscription: boolean
  state: BillingState
  platformBlocked: boolean
  /** Título e explicação da situação (describeBillingState), prontos no servidor. */
  stateTitle: string
  stateDescription: string
}

export type PricingAccount = {
  user: { name: string; email: string | null; avatarUrl: string | null }
  tenancyMode: TenancyMode
  organizations: PricingOrganization[]
  selectedOrganizationId: string | null
  /** Painel da imobiliária escolhida (ou a escolha de imobiliária / onboarding). */
  panelHref: string
  /** Assinatura e faturas no CRM; null para quem não vê a assinatura. */
  subscriptionHref: string | null
  /**
   * Equipe da imobiliária escolhida no CRM. Sempre com a origem certa (o
   * subdomínio dela, não a raiz), para o link funcionar de /planos.
   */
  teamSettingsHref: string
  /** null: sem imobiliária escolhida ou resumo indisponível agora. */
  billing: PricingBilling | null
  /** Só o dono assina, troca de plano ou abre o portal de pagamento. */
  canManage: boolean
  stripeConfigured: boolean
  /**
   * Assinar e trocar de plano por esta página. As Server Actions recebem a
   * imobiliária escolhida (conferida no servidor), então valem nos dois modos;
   * false desliga os botões com o aviso de blockedActionReason.
   */
  actionsAvailable: boolean
  checkout: { status: CheckoutReturnStatus; confirmed: boolean } | null
}

/** Plano pago em vigor (com assinatura na Stripe); null no teste ou sem assinatura. */
export function currentPaidPlan(billing: PricingBilling | null): PlanKey | null {
  return billing?.hasSubscription && isPlanKey(billing.planKey) ? billing.planKey : null
}

/** Usuários extras contratados hoje no plano pago em vigor. */
export function currentExtraSeats(billing: PricingBilling | null) {
  const plan = currentPaidPlan(billing)
  return plan && billing ? Math.max(0, billing.seats - PLANS[plan].usersIncluded) : 0
}

/** Pacotes de +10 imóveis contratados hoje no plano pago em vigor. */
export function currentOwnedListingPacks(billing: PricingBilling | null) {
  return currentPaidPlan(billing) && billing ? billing.ownedListingPacks : 0
}

/** Motivo de os botões de assinatura estarem desabilitados; null quando liberados. */
export function blockedActionReason(account: PricingAccount): string | null {
  if (!account.canManage) {
    return "Só o dono da imobiliária pode alterar o plano."
  }

  if (!account.stripeConfigured) {
    return "Os pagamentos estão em configuração. Assinar e trocar de plano ficam disponíveis assim que terminarmos."
  }

  if (!account.actionsAvailable) {
    return "Nesta instalação, assinar e trocar de plano por esta página ainda não está liberado. Fale com o suporte para mudar de plano."
  }

  return null
}

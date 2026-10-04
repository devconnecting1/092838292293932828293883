"use client"

import Link from "next/link"
import { ExternalLinkIcon } from "lucide-react"

import { PLANS, type PlanKey } from "@workspace/core/billing"
import { Button } from "@workspace/ui/components/button"
import { Spinner } from "@workspace/ui/components/spinner"

import { signUpHref } from "@/components/billing/plan-content"
import { blockedActionReason, currentPaidPlan } from "@/components/billing/pricing-account"
import { usePricing } from "@/components/billing/pricing-provider"
import { useBillingRedirect } from "@/components/billing/use-billing-redirect"
import { ONBOARDING_PATH } from "@/lib/auth/routes"
import { openBillingPortal } from "@/lib/billing/actions"

/** Id do texto que explica por que os botões de plano estão desabilitados. */
export const PLAN_ACTIONS_HINT_ID = "planos-acoes-aviso"

type PlanActionButtonProps = {
  plan: PlanKey
  size?: "default" | "sm" | "lg"
  className?: string
}

/**
 * Botão do plano, igual nos cartões, no recomendador e na tabela:
 * - visitante: teste grátis com o plano pré-escolhido;
 * - sem assinatura: Assinar (Checkout da Stripe, depois da confirmação);
 * - com assinatura: Trocar para este, ou Gerenciar pagamento no plano atual.
 * Conta suspensa pela plataforma não recebe botão: assinar não a libera.
 */
export function PlanActionButton({ plan, size = "lg", className }: PlanActionButtonProps) {
  const { account, interval, choosePlan } = usePricing()
  const { busy, run } = useBillingRedirect()
  const details = PLANS[plan]

  if (!account) {
    return (
      <Button
        size={size}
        variant={details.highlight ? "default" : "outline"}
        className={className}
        render={<Link href={signUpHref(plan)} />}
        nativeButton={false}
        aria-label={`Começar teste grátis no plano ${details.name}`}
      >
        Começar teste grátis
      </Button>
    )
  }

  if (account.organizations.length === 0) {
    return (
      <Button
        size={size}
        variant={details.highlight ? "default" : "outline"}
        className={className}
        render={<Link href={ONBOARDING_PATH} />}
        nativeButton={false}
      >
        Criar imobiliária
      </Button>
    )
  }

  const billing = account.billing

  if (!billing || billing.platformBlocked) {
    return null
  }

  const current = currentPaidPlan(billing)
  const isCurrent = plan === current
  const reason = blockedActionReason(account)
  const describedBy = reason ? PLAN_ACTIONS_HINT_ID : undefined

  if (isCurrent && billing.interval === interval) {
    const paymentPending = billing.state === "grace"

    return (
      <Button
        type="button"
        size={size}
        variant="secondary"
        className={className}
        disabled={reason !== null || busy !== null}
        aria-describedby={describedBy}
        onClick={() => {
          void run(
            "portal",
            () =>
              openBillingPortal({
                ...(paymentPending ? { flow: "payment_method_update" as const } : {}),
                // O servidor confere se o usuário é dono desta imobiliária.
                organizationId: account.selectedOrganizationId ?? undefined,
                returnTo: "planos",
              }),
            "Não foi possível abrir o portal de pagamento"
          )
        }}
      >
        {busy ? (
          <Spinner data-icon="inline-start" aria-label="Abrindo" />
        ) : (
          <ExternalLinkIcon data-icon="inline-start" />
        )}
        {paymentPending ? "Atualizar pagamento" : "Gerenciar pagamento"}
      </Button>
    )
  }

  const label = billing.hasSubscription
    ? isCurrent
      ? `Mudar para ${interval === "year" ? "anual" : "mensal"}`
      : "Trocar para este"
    : "Assinar"

  return (
    <Button
      type="button"
      size={size}
      variant={details.highlight && !billing.hasSubscription ? "default" : "outline"}
      className={className}
      disabled={reason !== null}
      aria-describedby={describedBy}
      aria-label={
        billing.hasSubscription
          ? `${label}: plano ${details.name}`
          : `Assinar o plano ${details.name}`
      }
      onClick={() => choosePlan(plan)}
    >
      {label}
    </Button>
  )
}

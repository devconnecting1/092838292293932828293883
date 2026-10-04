"use client"

import Link from "next/link"
import { Building2Icon, CircleAlertIcon, LockIcon, SettingsIcon } from "lucide-react"

import { BILLING_INTERVAL_LABELS } from "@workspace/core/billing"
import { Alert, AlertAction, AlertDescription, AlertTitle } from "@workspace/ui/components/alert"
import { Avatar, AvatarFallback } from "@workspace/ui/components/avatar"
import { Button } from "@workspace/ui/components/button"
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemMedia,
  ItemTitle,
} from "@workspace/ui/components/item"

import { BillingStateBadge } from "@/components/billing/billing-state-badge"
import { CheckoutReturnNotice } from "@/components/billing/checkout-return-notice"
import { planDisplayName } from "@/components/billing/overview-view"
import { PLAN_ACTIONS_HINT_ID } from "@/components/billing/plan-action-button"
import { blockedActionReason, currentPaidPlan } from "@/components/billing/pricing-account"
import { usePricing } from "@/components/billing/pricing-provider"
import { getInitials } from "@/components/crm/utils"
import { ONBOARDING_PATH } from "@/lib/auth/routes"

/**
 * Faixa da conta conectada acima dos cartões: imobiliária escolhida, plano e
 * situação, retorno do pagamento e por que os botões estão desabilitados.
 */
export function PricingAccountSummary() {
  const { account, choosePlan } = usePricing()

  if (!account) {
    return null
  }

  if (account.organizations.length === 0) {
    return (
      <Alert>
        <Building2Icon />
        <AlertTitle>Você ainda não tem uma imobiliária</AlertTitle>
        <AlertDescription>
          Crie a sua para usar o teste grátis e, depois, assinar um plano.
        </AlertDescription>
        <AlertAction>
          <Button size="sm" render={<Link href={ONBOARDING_PATH} />} nativeButton={false}>
            Criar imobiliária
          </Button>
        </AlertAction>
      </Alert>
    )
  }

  const billing = account.billing
  const organizationName =
    account.organizations.find((organization) => organization.id === account.selectedOrganizationId)
      ?.name ?? "Imobiliária"

  if (!billing) {
    return (
      <Alert variant="destructive">
        <CircleAlertIcon />
        <AlertTitle>Não foi possível carregar a assinatura de {organizationName}</AlertTitle>
        <AlertDescription>
          Recarregue a página em instantes. Os planos e preços abaixo continuam valendo.
        </AlertDescription>
      </Alert>
    )
  }

  const current = currentPaidPlan(billing)
  const reason = blockedActionReason(account)

  return (
    <div className="flex flex-col gap-3">
      {account.checkout ? (
        <CheckoutReturnNotice
          status={account.checkout.status}
          confirmed={account.checkout.confirmed}
        />
      ) : null}

      <Item variant="outline">
        <ItemMedia aria-hidden="true">
          <Avatar>
            <AvatarFallback>{getInitials(organizationName)}</AvatarFallback>
          </Avatar>
        </ItemMedia>
        <ItemContent>
          <ItemTitle>
            {organizationName}
            <BillingStateBadge state={billing.state} />
          </ItemTitle>
          <ItemDescription className="line-clamp-none">
            {planDisplayName(billing.planKey)}
            {billing.interval
              ? `, cobrança ${BILLING_INTERVAL_LABELS[billing.interval].label.toLowerCase()}`
              : ""}
            . {billing.stateTitle}.
          </ItemDescription>
        </ItemContent>
        <ItemActions className="flex-wrap">
          {current && !reason && !billing.platformBlocked ? (
            <Button type="button" variant="outline" size="sm" onClick={() => choosePlan(current)}>
              Alterar usuários e imóveis extras
            </Button>
          ) : null}
          {account.subscriptionHref ? (
            <Button
              variant="ghost"
              size="sm"
              render={<a href={account.subscriptionHref} />}
              nativeButton={false}
            >
              <SettingsIcon data-icon="inline-start" />
              Assinatura e faturas
            </Button>
          ) : null}
        </ItemActions>
      </Item>

      {billing.platformBlocked ? (
        <Alert variant="destructive">
          <LockIcon />
          <AlertTitle>{billing.stateTitle}</AlertTitle>
          <AlertDescription>{billing.stateDescription}</AlertDescription>
        </Alert>
      ) : reason ? (
        <Alert>
          <LockIcon />
          <AlertTitle>Planos só para consulta</AlertTitle>
          <AlertDescription id={PLAN_ACTIONS_HINT_ID}>{reason}</AlertDescription>
        </Alert>
      ) : null}
    </div>
  )
}

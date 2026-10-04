import Link from "next/link"
import { CircleAlertIcon, ClockIcon, LockIcon } from "lucide-react"

import { Alert, AlertDescription, AlertTitle } from "@workspace/ui/components/alert"

import { loadBillingOverview } from "@/components/billing/billing-data"
import { getBannerMessage } from "@/components/billing/overview-view"
import { plansPageHref } from "@/components/billing/plans-page-link"
import { hasRole, ORGANIZATION_VIEWER_ROLES, type Role } from "@/lib/auth/roles"
import { SUBSCRIPTION_SETTINGS_PATH } from "@/lib/auth/routes"
import { getOrganizationContext } from "@/lib/auth/session"

type SubscriptionBannerProps = {
  organizationId: string
  role: Role
}

/**
 * Aviso global da casca do CRM: teste com até 3 dias, carência ou modo leitura.
 * Sem resumo (RPC indisponível) ou fora desses estados, não renderiza nada.
 */
export async function SubscriptionBanner({ organizationId, role }: SubscriptionBannerProps) {
  const overview = await loadBillingOverview(organizationId)
  const message = overview ? getBannerMessage(overview) : null

  if (!overview || !message) {
    return null
  }

  const paymentPending = overview.state === "grace" && overview.hasSubscription
  // Regularizar o pagamento é na assinatura; escolher um plano, em /planos (fora do painel).
  const context = paymentPending ? null : await getOrganizationContext()
  const organizationSlug =
    context?.membership?.organizationId === organizationId
      ? context.membership.organization.slug
      : null

  const Icon =
    overview.state === "read_only"
      ? LockIcon
      : overview.state === "grace"
        ? CircleAlertIcon
        : ClockIcon

  return (
    <div className="px-4 pt-4 lg:px-6">
      {/* Modo leitura já travou a conta (problema); teste acabando e carência ainda são aviso. */}
      <Alert variant={overview.state === "read_only" ? "destructive" : "warning"} role="status">
        <Icon />
        <AlertTitle>{message.title}</AlertTitle>
        <AlertDescription>
          {overview.platformBlocked ? (
            message.description
          ) : hasRole(role, ORGANIZATION_VIEWER_ROLES) ? (
            paymentPending ? (
              <Link href={SUBSCRIPTION_SETTINGS_PATH}>Regularizar o pagamento</Link>
            ) : (
              <a href={plansPageHref(organizationSlug)}>Ver planos e assinar</a>
            )
          ) : (
            "Avise o dono da imobiliária para regularizar a assinatura."
          )}
        </AlertDescription>
      </Alert>
    </div>
  )
}

import "server-only"

import { loadBillingOverview } from "@/components/billing/billing-data"
import type { CheckoutReturnStatus } from "@/components/billing/checkout-return-notice"
import { describeBillingState, isSubscriptionConfirmed } from "@/components/billing/overview-view"
import type { PricingAccount, PricingOrganization } from "@/components/billing/pricing-account"
import { hasRole, ORGANIZATION_VIEWER_ROLES, ROLE_LABELS } from "@/lib/auth/roles"
import {
  HOME_PATH,
  ONBOARDING_PATH,
  PLANS_ORGANIZATION_PARAM,
  PLANS_PATH,
  SUBSCRIPTION_SETTINGS_PATH,
  TENANT_PICKER_PATH,
} from "@/lib/auth/routes"
import { getOrganizationContext, type Membership } from "@/lib/auth/session"
import { isStripeConfigured } from "@/lib/billing/queries"
import { isSupabaseConfigured } from "@/lib/supabase/env"
import { buildTenantUrl, getTenancyMode, isValidTenantSlug } from "@/lib/tenant/urls"

/** Equipe da imobiliária no CRM (settings-config.ts define o mesmo caminho). */
const TEAM_SETTINGS_PATH = "/configuracoes/equipe"

type PricingAccountInput = {
  /** Slug pedido em ?imobiliaria=, conferido entre as memberships (nos dois modos). */
  organizationSlug: string | null
  checkout: CheckoutReturnStatus | null
}

function tenantHref(membership: Membership | null, path: string, subdomain: boolean) {
  if (!subdomain) {
    return path
  }

  return membership && isValidTenantSlug(membership.organization.slug)
    ? buildTenantUrl(membership.organization.slug, path)
    : null
}

/**
 * Conta conectada para /planos: usuário, imobiliárias ATIVAS (consulta com RLS)
 * e o resumo da assinatura da escolhida. A imobiliária escolhida é o slug
 * pedido em ?imobiliaria= quando ele está entre as memberships ativas do
 * usuário; senão, o cookie validado (host único) ou a primeira membership
 * (modo subdomain). Sem sessão, ou se a leitura falhar, devolve null e a
 * página mostra a versão de visitante.
 */
export async function loadPricingAccount({
  organizationSlug,
  checkout,
}: PricingAccountInput): Promise<PricingAccount | null> {
  if (!isSupabaseConfigured()) {
    return null
  }

  let context: Awaited<ReturnType<typeof getOrganizationContext>>

  try {
    context = await getOrganizationContext()
  } catch (error) {
    console.error(
      "[planos] falha ao carregar a conta conectada:",
      error instanceof Error ? error.name : "erro desconhecido"
    )
    return null
  }

  if (!context) {
    return null
  }

  const tenancyMode = getTenancyMode()
  const subdomain = tenancyMode === "subdomain"
  const { user, memberships } = context
  // ?imobiliaria= só vale entre as memberships ATIVAS do usuário (RLS já
  // filtrou); no host único ela tem prioridade sobre o cookie (ex.: volta do
  // pagamento de uma imobiliária diferente da escolhida no cookie), mas sem
  // ela ou inválida, cai no cookie (context.membership).
  const requested = organizationSlug
    ? (memberships.find((item) => item.organization.slug === organizationSlug) ?? null)
    : null
  const selected = subdomain
    ? (requested ?? memberships[0] ?? null)
    : (requested ?? context.membership)

  const organizations: PricingOrganization[] = memberships.map((item) => ({
    id: item.organizationId,
    name: item.organization.name,
    roleLabel: ROLE_LABELS[item.role],
    plansHref:
      subdomain && isValidTenantSlug(item.organization.slug)
        ? `${PLANS_PATH}?${new URLSearchParams({ [PLANS_ORGANIZATION_PARAM]: item.organization.slug }).toString()}`
        : null,
  }))

  const overview = selected ? await loadBillingOverview(selected.organizationId) : null
  const stateMessage = overview ? describeBillingState(overview) : null
  const canViewSubscription = selected ? hasRole(selected.role, ORGANIZATION_VIEWER_ROLES) : false

  return {
    user: {
      name: user.fullName ?? user.email ?? "Usuário",
      email: user.email,
      avatarUrl: user.avatarUrl,
    },
    tenancyMode,
    organizations,
    selectedOrganizationId: selected?.organizationId ?? null,
    panelHref: selected
      ? (tenantHref(selected, HOME_PATH, subdomain) ?? TENANT_PICKER_PATH)
      : ONBOARDING_PATH,
    subscriptionHref: canViewSubscription
      ? tenantHref(selected, SUBSCRIPTION_SETTINGS_PATH, subdomain)
      : null,
    // No modo subdomain, "/configuracoes/equipe" sem origem cairia na escolha de
    // imobiliária (a raiz não atende o CRM): monta com a origem da imobiliária
    // escolhida. Sem imobiliária válida, sobra o caminho relativo mesmo.
    teamSettingsHref: tenantHref(selected, TEAM_SETTINGS_PATH, subdomain) ?? TEAM_SETTINGS_PATH,
    billing:
      overview && stateMessage
        ? {
            planKey: overview.planKey,
            interval: overview.interval,
            seats: overview.seats,
            ownedListingPacks: overview.ownedListingPacks,
            usersInUse: overview.usage.users,
            currentPeriodEnd: overview.currentPeriodEnd,
            hasSubscription: overview.hasSubscription,
            state: overview.state,
            platformBlocked: overview.platformBlocked,
            stateTitle: stateMessage.title,
            stateDescription: stateMessage.description,
          }
        : null,
    canManage: selected?.role === "owner",
    stripeConfigured: isStripeConfigured(),
    // As ações de cobrança recebem a imobiliária escolhida (conferida no servidor):
    // funcionam no host único e na raiz do modo subdomain.
    actionsAvailable: true,
    checkout: checkout ? { status: checkout, confirmed: isSubscriptionConfirmed(overview) } : null,
  }
}

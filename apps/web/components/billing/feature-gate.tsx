import "server-only"

import { SparklesIcon } from "lucide-react"

import {
  FEATURES,
  PLAN_KEYS,
  PLANS,
  planHasFeature,
  type FeatureKey,
} from "@workspace/core/billing"
import { Button } from "@workspace/ui/components/button"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@workspace/ui/components/empty"

import { loadBillingOverview } from "@/components/billing/billing-data"
import { overviewHasFeature } from "@/components/billing/overview-view"
import { plansPageHref } from "@/components/billing/plans-page-link"
import { hasRole, ORGANIZATION_VIEWER_ROLES } from "@/lib/auth/roles"
import { getOrganizationContext } from "@/lib/auth/session"

type FeatureGateProps = {
  feature: FeatureKey
  /** Substitui o convite padrão de upgrade. */
  fallback?: React.ReactNode
  children: React.ReactNode
}

/**
 * Libera `children` quando o plano da imobiliária inclui o recurso. Serve para
 * ações e telas novas: não esconda com ele dados que já existem.
 * Resumo indisponível (RPC com erro): não bloqueia; o banco segue aplicando
 * limites e o modo leitura.
 */
export async function FeatureGate({ feature, fallback, children }: FeatureGateProps) {
  const context = await getOrganizationContext()
  const membership = context?.membership ?? null

  if (!membership) {
    return fallback ?? <FeatureUpgradeEmpty feature={feature} canManage={false} />
  }

  const overview = await loadBillingOverview(membership.organizationId)

  if (!overview || overviewHasFeature(overview, feature)) {
    return children
  }

  return (
    fallback ?? (
      <FeatureUpgradeEmpty
        feature={feature}
        canManage={hasRole(membership.role, ORGANIZATION_VIEWER_ROLES)}
        plansHref={plansPageHref(membership.organization.slug)}
      />
    )
  )
}

export function FeatureUpgradeEmpty({
  feature,
  canManage,
  plansHref = plansPageHref(),
}: {
  feature: FeatureKey
  canManage: boolean
  /** /planos (fora do painel), com a imobiliária atual no modo subdomain. */
  plansHref?: string
}) {
  const definition = FEATURES[feature]
  const firstPlan = PLAN_KEYS.find((plan) => planHasFeature(plan, feature))

  return (
    <Empty className="border">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <SparklesIcon />
        </EmptyMedia>
        <EmptyTitle>{definition.label} não faz parte do seu plano</EmptyTitle>
        <EmptyDescription>
          {definition.description}
          {firstPlan ? ` Disponível a partir do plano ${PLANS[firstPlan].name}.` : ""}
          {definition.status === "soon" ? " Este recurso chega em breve." : ""}
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        {canManage ? (
          <Button render={<a href={plansHref} />} nativeButton={false}>
            Ver planos
          </Button>
        ) : (
          <p className="text-muted-foreground">Peça ao dono da imobiliária para mudar de plano.</p>
        )}
      </EmptyContent>
    </Empty>
  )
}

import { ImagesIcon, TriangleAlertIcon } from "lucide-react"

import {
  formatBRL,
  isAtLimit,
  isNearLimit,
  OWNED_LISTING_RELEASED_STATUS_PLURAL_TEXT,
  OWNED_LISTINGS_PACK_PRICE,
  OWNED_LISTINGS_PACK_SIZE,
  PLAN_KEYS,
  PLANS,
  TRIAL_BASE_PLAN,
  TRIAL_LIMITS,
} from "@workspace/core/billing"
import { Alert, AlertDescription, AlertTitle } from "@workspace/ui/components/alert"
import { Badge } from "@workspace/ui/components/badge"

import { loadBillingOverview, loadOwnedListingUsage } from "@/components/billing/billing-data"
import { pluralize } from "@/components/billing/plan-content"
import { plansPageHref } from "@/components/billing/plans-page-link"
import { SUBSCRIPTION_SETTINGS_PATH } from "@/lib/auth/routes"
import type { BillingOverview } from "@/lib/billing/queries"
import { formatNumber } from "@/lib/format"

type OwnedListingsUsageNoticeProps = {
  organizationId: string
  organizationSlug: string
  /** Só o dono compra pacotes ou assina; os demais veem o número. */
  isOwner: boolean
}

/** Limite atual (com pacotes). Chave ausente cai no catálogo, nunca em "ilimitado". */
function currentLimit(overview: BillingOverview) {
  const catalog = overview.planKey === "trial" ? TRIAL_LIMITS : PLANS[overview.planKey].limits
  return overview.limits.owned_listings ?? catalog.owned_listings
}

const packPrice = `${formatBRL(OWNED_LISTINGS_PACK_PRICE.month, { omitZeroCents: true })}/mês`

/**
 * "X de N imóveis com foto" no topo de /imoveis, com o caminho para comprar
 * pacotes de +10 imóveis. No teste grátis (limite do plano Equipe) avisa que,
 * ao assinar, vale o limite do plano escolhido — para ninguém descobrir a queda
 * pelo erro no dia de pagar. A contagem é a do banco (a mesma do gatilho).
 */
export async function OwnedListingsUsageNotice({
  organizationId,
  organizationSlug,
  isOwner,
}: OwnedListingsUsageNoticeProps) {
  const [overview, used] = await Promise.all([
    loadBillingOverview(organizationId),
    loadOwnedListingUsage(organizationId),
  ])

  if (!overview || used === null || overview.platformBlocked) {
    return null
  }

  const limit = currentLimit(overview)
  const atLimit = isAtLimit(limit, used)
  const nearLimit = isNearLimit(limit, used)
  const inTrial = !overview.hasSubscription && overview.state !== "read_only"
  const plansHref = `${plansPageHref(organizationSlug)}#adicionais`
  const buyHref = overview.hasSubscription
    ? `${SUBSCRIPTION_SETTINGS_PATH}#imoveis-extras`
    : plansHref
  const smallerPlans = PLAN_KEYS.filter(
    (plan) => PLANS[plan].limits.owned_listings < TRIAL_LIMITS.owned_listings
  )
  const planLimits = PLAN_KEYS.map(
    (plan) => `${PLANS[plan].name} ${formatNumber(PLANS[plan].limits.owned_listings)}`
  ).join(", ")
  const exceedsSmaller = smallerPlans.filter((plan) => used > PLANS[plan].limits.owned_listings)

  return (
    <div className="flex flex-col gap-3">
      <div
        className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm"
        role="status"
        aria-live="polite"
      >
        <span className="flex items-center gap-2 font-medium">
          <ImagesIcon aria-hidden="true" className="size-4 text-muted-foreground" />
          <span>
            <span className="tabular-nums">
              {formatNumber(used)} de {formatNumber(limit)}
            </span>{" "}
            imóveis com foto
          </span>
        </span>
        {nearLimit ? (
          <Badge variant={atLimit ? "destructive" : "secondary"}>
            {atLimit ? "Limite atingido" : "Perto do limite"}
          </Badge>
        ) : null}
        <span className="text-muted-foreground">
          Imóveis {OWNED_LISTING_RELEASED_STATUS_PLURAL_TEXT} ou sem foto não contam.
        </span>
        {isOwner && !inTrial ? (
          <a href={buyHref} className="font-medium underline-offset-4 hover:underline">
            {overview.ownedListingPacks > 0 ? "Alterar imóveis extras" : "Comprar +10 imóveis"}
          </a>
        ) : null}
      </div>

      {inTrial ? (
        <Alert>
          <TriangleAlertIcon />
          <AlertTitle>No teste, o limite é o do plano {PLANS[TRIAL_BASE_PLAN].name}</AlertTitle>
          <AlertDescription>
            <p>
              Hoje você usa {pluralize(used, "imóvel com foto", "imóveis com foto")} de{" "}
              {formatNumber(limit)}. Ao assinar, vale o limite do plano escolhido: {planLimits}.
              {exceedsSmaller.length > 0
                ? ` No ${exceedsSmaller.map((plan) => PLANS[plan].name).join(" ou no ")}, a foto de um imóvel novo ficaria bloqueada até liberar vagas.`
                : ""}{" "}
              Para caber mais, some pacotes de +{OWNED_LISTINGS_PACK_SIZE} imóveis por {packPrice}.
              Nada do que você cadastrou é apagado.
            </p>
            {isOwner ? (
              <p>
                <a href={plansHref}>Ver planos e pacotes de imóveis</a>
              </p>
            ) : (
              <p>Quem assina e contrata pacotes é o dono da imobiliária.</p>
            )}
          </AlertDescription>
        </Alert>
      ) : null}
    </div>
  )
}

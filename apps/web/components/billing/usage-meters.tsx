import { TriangleAlertIcon } from "lucide-react"

import {
  formatBRL,
  formatLimit,
  isAtLimit,
  isNearLimit,
  OWNED_LISTING_RELEASED_STATUS_PLURAL_TEXT,
  OWNED_LISTING_RELEASED_STATUS_TEXT,
  OWNED_LISTINGS_PACK_PRICE,
  OWNED_LISTINGS_PACK_SIZE,
  OWNED_LISTINGS_SHORT_LABEL,
  PLAN_KEYS,
  PLANS,
  TRIAL_LIMITS,
  usageRatio,
  type BillingPlanKey,
  type PlanKey,
} from "@workspace/core/billing"
import { Alert, AlertDescription, AlertTitle } from "@workspace/ui/components/alert"
import { Badge } from "@workspace/ui/components/badge"
import { Progress, ProgressLabel } from "@workspace/ui/components/progress"

import { pluralize } from "@/components/billing/plan-content"
import type { BillingOverview } from "@/lib/billing/queries"
import { formatNumber } from "@/lib/format"

type MeterKey = "users" | "landing_pages" | "owned_listings"

type Meter = { key: MeterKey; label: string; used: number; limit: number }

/** Próximo plano cujo limite comporta o uso atual (mais um item). */
function nextPlanFor(planKey: BillingPlanKey, key: MeterKey, used: number): PlanKey | null {
  const start = planKey === "trial" ? 0 : PLAN_KEYS.indexOf(planKey) + 1

  return (
    PLAN_KEYS.slice(start).find((plan) => {
      const limit = PLANS[plan].limits[key]
      return limit < 0 || limit > used
    }) ?? null
  )
}

function ownedListingsWarning(meter: Meter, planKey: BillingPlanKey, usage: string) {
  const suggestion = nextPlanFor(planKey, meter.key, meter.used)
  const pack = `, contrate pacotes de +${OWNED_LISTINGS_PACK_SIZE} imóveis por ${formatBRL(OWNED_LISTINGS_PACK_PRICE.month, { omitZeroCents: true })}/mês`
  const upgrade = suggestion
    ? `${pack} ou mude para o plano ${PLANS[suggestion].name}, com até ${pluralize(PLANS[suggestion].limits.owned_listings, "imóvel com foto", "imóveis com foto")}`
    : `${pack}`

  // O banco barra a PRIMEIRA foto de um imóvel novo, e também reativar um imóvel
  // com foto que estava vendido, alugado ou inativo.
  return isAtLimit(meter.limit, meter.used)
    ? `${usage} Para enviar fotos de outro imóvel, marque como ${OWNED_LISTING_RELEASED_STATUS_TEXT} um imóvel que saiu da carteira${upgrade}.`
    : `${usage} Imóveis ${OWNED_LISTING_RELEASED_STATUS_PLURAL_TEXT} ou na lixeira não contam: mantenha o status da carteira em dia${upgrade}.`
}

function warningText(meter: Meter, planKey: BillingPlanKey) {
  const suggestion = nextPlanFor(planKey, meter.key, meter.used)
  const usage = `${meter.label}: ${formatNumber(meter.used)} de ${formatLimit(meter.limit)}.`

  if (meter.key === "owned_listings") {
    return ownedListingsWarning(meter, planKey, usage)
  }

  if (meter.key === "users") {
    return suggestion
      ? `${usage} Contrate usuários extras ou mude para o plano ${PLANS[suggestion].name}, com ${pluralize(PLANS[suggestion].usersIncluded, "usuário incluído", "usuários incluídos")}.`
      : `${usage} Contrate usuários extras para crescer a equipe.`
  }

  // Todos os planos têm a mesma franquia de landing page, então não há plano
  // maior a sugerir: o caminho é despublicar a atual e publicar outra.
  if (!suggestion) {
    return `${usage} Despublique a página que está no ar para publicar outra; os modelos continuam todos disponíveis.`
  }

  const limit = PLANS[suggestion].limits.landing_pages
  return `${usage} O plano ${PLANS[suggestion].name} permite ${
    limit < 0 ? "landing pages ilimitadas" : pluralize(limit, "landing page", "landing pages")
  }.`
}

/**
 * Limite de imóveis com foto. Chave ausente no resumo cai no catálogo do plano,
 * nunca em "ilimitado": o banco aplica esse limite em todos os planos.
 */
function ownedListingsLimit(overview: BillingOverview) {
  const catalog = overview.planKey === "trial" ? TRIAL_LIMITS : PLANS[overview.planKey].limits
  return overview.limits.owned_listings ?? catalog.owned_listings
}

type UsageMetersProps = {
  overview: BillingOverview
  /**
   * Imóveis com foto que contam no limite, lidos do banco (mesma contagem do
   * gatilho). null = não foi possível ler agora.
   */
  ownedListings: number | null
  /** Mostra o link para os planos (quem pode assinar ou trocar). */
  upgradeHref?: string
}

/** Medidores de uso contra o limite do plano, com aviso a partir de 80% e no limite. */
export function UsageMeters({ overview, ownedListings, upgradeHref }: UsageMetersProps) {
  const meters: Meter[] = [
    {
      key: "users",
      label: "Usuários",
      used: overview.usage.users,
      limit: overview.limits.users ?? overview.seats,
    },
    {
      key: "landing_pages",
      label: "Landing pages publicadas",
      used: overview.usage.landingPages,
      // Chave ausente = ilimitado.
      limit: overview.limits.landing_pages ?? -1,
    },
    ...(ownedListings === null
      ? []
      : [
          {
            key: "owned_listings" as const,
            label: OWNED_LISTINGS_SHORT_LABEL,
            used: ownedListings,
            limit: ownedListingsLimit(overview),
          },
        ]),
  ]

  const warnings = meters.filter((meter) => isNearLimit(meter.limit, meter.used))
  const anyAtLimit = warnings.some((meter) => isAtLimit(meter.limit, meter.used))

  return (
    <div className="flex flex-col gap-6">
      {meters.map((meter) => {
        const ratio = usageRatio(meter.limit, meter.used)
        const atLimit = isAtLimit(meter.limit, meter.used)

        return (
          <div key={meter.key} className="flex flex-col gap-2">
            {ratio === null ? (
              <div className="flex flex-wrap items-center gap-3">
                <span className="text-sm font-medium">{meter.label}</span>
                <span className="ms-auto text-sm text-muted-foreground tabular-nums">
                  {formatNumber(meter.used)} · Ilimitado
                </span>
              </div>
            ) : (
              <Progress value={Math.min(100, Math.round(ratio * 100))}>
                <ProgressLabel>{meter.label}</ProgressLabel>
                <span className="ms-auto text-sm text-muted-foreground tabular-nums">
                  {formatNumber(meter.used)} de {formatLimit(meter.limit)}
                </span>
              </Progress>
            )}
            {isNearLimit(meter.limit, meter.used) ? (
              <Badge variant={atLimit ? "destructive" : "secondary"}>
                {atLimit ? "Limite atingido" : "Perto do limite"}
              </Badge>
            ) : null}
          </div>
        )
      })}

      {ownedListings === null ? (
        <p className="text-sm text-muted-foreground">
          {OWNED_LISTINGS_SHORT_LABEL}: não deu para carregar a contagem agora. O limite do plano
          continua valendo ao enviar fotos.
        </p>
      ) : null}

      <p className="text-sm text-muted-foreground">
        {OWNED_LISTINGS_SHORT_LABEL} são os imóveis à venda ou para alugar com fotos hospedadas por
        nós, inclusive as trazidas por link na importação de planilhas. Imóveis{" "}
        {OWNED_LISTING_RELEASED_STATUS_PLURAL_TEXT}, sem foto ou só com fotos no site de origem não
        contam, e clientes e condomínios não têm limite.
      </p>

      {warnings.length > 0 ? (
        <Alert variant={anyAtLimit ? "destructive" : "warning"}>
          <TriangleAlertIcon />
          <AlertTitle>
            {anyAtLimit ? "Limite do plano atingido" : "Perto do limite do plano"}
          </AlertTitle>
          <AlertDescription>
            {warnings.map((meter) => (
              <p key={meter.key}>{warningText(meter, overview.planKey)}</p>
            ))}
            {upgradeHref ? (
              <p>
                <a href={upgradeHref}>Ver opções de plano</a>
              </p>
            ) : (
              <p>Para mudar de plano, fale com o dono da imobiliária.</p>
            )}
          </AlertDescription>
        </Alert>
      ) : null}
    </div>
  )
}

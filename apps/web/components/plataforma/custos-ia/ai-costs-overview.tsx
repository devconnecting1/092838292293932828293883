import Link from "next/link"
import { CircleCheckIcon, TriangleAlertIcon } from "lucide-react"

import {
  AI_COST_CYCLE_LABELS,
  AI_COST_CYCLES,
  formatAiMillicents,
  formatAiRatio,
  type AiConversationCalibration,
  type AiCostCycle,
  type AiCostRow,
  type AiCostSummary,
  type AiModelPriceSnapshot,
  type AiPricingCheck,
  type PlatformAiCostsSnapshot,
} from "@workspace/core/platform/ai-costs"
import {
  AI_COST_CAP_FRANCHISE_SLACK,
  AI_COST_CAP_PCT,
  AI_MODEL_CATALOG,
  AI_USAGE_KIND_LABELS,
  isAiModel,
  type AiTypicalUsageCost,
} from "@workspace/core/billing/ai-usage"
import { formatBRL } from "@workspace/core/billing/format"
import { isBillingPlanKey, PLANS } from "@workspace/core/billing/plans"
import { BILLING_STATE_LABELS, type BillingState } from "@workspace/core/billing/state"
import { Alert, AlertDescription, AlertTitle } from "@workspace/ui/components/alert"
import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"
import { Progress, ProgressLabel } from "@workspace/ui/components/progress"

import { formatDate, formatNumber } from "@/lib/format"
import { PLATFORM_AI_COSTS_PATH } from "@/lib/plataforma/custos-ia"

function planLabel(planKey: string): string {
  if (planKey === "trial") {
    return "Teste grátis"
  }

  return isBillingPlanKey(planKey) && planKey !== "trial" ? PLANS[planKey].name : planKey
}

function stateLabel(state: string): string {
  return state in BILLING_STATE_LABELS ? BILLING_STATE_LABELS[state as BillingState] : state
}

function progressValue(ratio: number | null): number | null {
  return ratio === null ? null : Math.min(100, Math.max(0, Math.round(ratio * 100)))
}

function CycleSwitch({ cycle }: { cycle: AiCostCycle }) {
  return (
    <nav aria-label="Ciclo" className="flex flex-wrap gap-2">
      {AI_COST_CYCLES.map((option) => (
        <Button
          key={option}
          variant={option === cycle ? "secondary" : "ghost"}
          aria-current={option === cycle ? "page" : undefined}
          render={
            <Link
              href={
                option === "atual"
                  ? PLATFORM_AI_COSTS_PATH
                  : `${PLATFORM_AI_COSTS_PATH}?ciclo=${option}`
              }
              scroll={false}
            />
          }
          nativeButton={false}
        >
          {AI_COST_CYCLE_LABELS[option]}
        </Button>
      ))}
    </nav>
  )
}

function SummaryCards({
  summary,
  snapshot,
}: {
  summary: AiCostSummary
  snapshot: PlatformAiCostsSnapshot
}) {
  const items = [
    {
      label: "Custo de IA no ciclo",
      value: formatAiMillicents(summary.totals.costMillicents),
      detail: `${formatNumber(summary.rows.length)} de ${formatNumber(snapshot.organizationsWithAi)} imobiliárias com IA no plano tiveram consumo.`,
    },
    {
      label: "Teto somado",
      value: formatBRL(summary.totalCapCents),
      detail: `${formatAiRatio(summary.totalCapRatio)} usado, só entre quem teve consumo.`,
    },
    {
      label: "Acima de 80% do teto",
      value: formatNumber(summary.overWarning.length),
      detail:
        summary.overWarning.length === 0
          ? "Nenhuma imobiliária perto do corte."
          : "Perto do corte: a IA para no teto.",
    },
    {
      label: "Conversas e requisições",
      value: `${formatNumber(summary.totals.conversations)} · ${formatNumber(summary.totals.requests)}`,
      detail: "Conversas da franquia · chamadas ao modelo.",
    },
  ]

  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {items.map((item) => (
        <Card key={item.label} size="sm">
          <CardContent>
            <dl className="flex flex-col gap-1">
              <dt className="text-xs text-muted-foreground">{item.label}</dt>
              <dd className="text-2xl font-semibold tabular-nums">{item.value}</dd>
              <dd className="text-xs text-muted-foreground">{item.detail}</dd>
            </dl>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}

function OrganizationRow({ row }: { row: AiCostRow }) {
  const value = progressValue(row.capRatio)

  return (
    <li className="flex min-w-0 flex-col gap-2 py-3 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex min-w-0 flex-col">
          <span className="truncate font-medium">{row.organizationName}</span>
          <span className="text-xs text-muted-foreground">
            {planLabel(row.planKey)} · {stateLabel(row.billingState)} · ciclo de{" "}
            {formatDate(row.periodStart)} a {formatDate(row.periodEnd)}
          </span>
        </div>
        {row.overWarning ? (
          <Badge variant="destructive">
            <TriangleAlertIcon data-icon="inline-start" />
            {formatAiRatio(row.capRatio)} do teto
          </Badge>
        ) : (
          <Badge variant="outline">
            {row.capRatio === null ? "Sem teto" : `${formatAiRatio(row.capRatio)} do teto`}
          </Badge>
        )}
      </div>
      {value !== null ? (
        <Progress value={value}>
          <ProgressLabel className="sr-only">
            Teto de IA usado por {row.organizationName}
          </ProgressLabel>
        </Progress>
      ) : null}
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-4">
        <div className="flex min-w-0 flex-col">
          <dt className="text-xs text-muted-foreground">Custo real</dt>
          <dd className="tabular-nums">
            {formatAiMillicents(row.usage.costMillicents)} de {formatBRL(row.capCents)}
          </dd>
        </div>
        <div className="flex min-w-0 flex-col">
          <dt className="text-xs text-muted-foreground">Conversas</dt>
          <dd className="tabular-nums">{formatNumber(row.usage.conversations)}</dd>
        </div>
        <div className="flex min-w-0 flex-col">
          <dt className="text-xs text-muted-foreground">Requisições</dt>
          <dd className="tabular-nums">{formatNumber(row.usage.requests)}</dd>
        </div>
        <div className="flex min-w-0 flex-col">
          <dt className="text-xs text-muted-foreground">Custo por conversa</dt>
          <dd className="tabular-nums">
            {row.costPerConversationMillicents === null
              ? "—"
              : formatAiMillicents(row.costPerConversationMillicents)}
          </dd>
        </div>
      </dl>
      <p className="text-xs break-words text-muted-foreground tabular-nums">
        Tokens: entrada {formatNumber(row.usage.inputTokens)} · saída{" "}
        {formatNumber(row.usage.outputTokens)} · cache lido{" "}
        {formatNumber(row.usage.cacheReadTokens)} · cache gravado{" "}
        {formatNumber(row.usage.cacheWriteTokens)}
      </p>
    </li>
  )
}

const TOKEN_LABELS = [
  ["inputTokens", "Entrada"],
  ["outputTokens", "Saída (com raciocínio)"],
  ["cacheReadTokens", "Leitura de cache"],
  ["cacheWriteTokens", "Escrita de cache"],
] as const

function CalibrationCard({ calibration }: { calibration: AiConversationCalibration }) {
  const needsReview = calibration.status === "acima"

  return (
    <Card>
      <CardHeader>
        <CardTitle>Conversa real x estimativa</CardTitle>
        <CardDescription>
          Custo médio medido por conversa contra a conversa típica usada nos planos
          (AI_TYPICAL_CONVERSATION), ao câmbio do banco. Inclui os pedidos avulsos, que contam 1
          conversa cada.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="flex flex-col gap-1">
            <dt className="text-xs text-muted-foreground">Medido</dt>
            <dd className="text-lg font-semibold tabular-nums">
              {calibration.measuredMillicents === null
                ? "—"
                : formatAiMillicents(calibration.measuredMillicents)}
            </dd>
          </div>
          <div className="flex flex-col gap-1">
            <dt className="text-xs text-muted-foreground">Estimado</dt>
            <dd className="text-lg font-semibold tabular-nums">
              {formatAiMillicents(calibration.estimatedMillicents)}
            </dd>
          </div>
          <div className="flex flex-col gap-1">
            <dt className="text-xs text-muted-foreground">Diferença</dt>
            <dd className="text-lg font-semibold tabular-nums">
              {calibration.deviation === null
                ? "—"
                : `${calibration.deviation > 0 ? "+" : ""}${formatAiRatio(calibration.deviation)}`}
            </dd>
          </div>
          <div className="flex flex-col gap-1">
            <dt className="text-xs text-muted-foreground">Amostra</dt>
            <dd className="text-lg font-semibold tabular-nums">
              {formatNumber(calibration.conversations)}
            </dd>
          </div>
        </dl>

        <Alert variant={needsReview ? "destructive" : "default"}>
          {needsReview ? <TriangleAlertIcon /> : <CircleCheckIcon />}
          <AlertTitle>
            {calibration.status === "acima"
              ? "Revise a estimativa"
              : calibration.status === "abaixo"
                ? "Dá para recalibrar para baixo"
                : calibration.status === "dentro"
                  ? "Estimativa em dia"
                  : "Ainda sem base para recalibrar"}
          </AlertTitle>
          <AlertDescription>{calibration.message}</AlertDescription>
        </Alert>

        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-medium">Tokens por conversa</h3>
          <dl className="flex flex-col divide-y text-sm">
            {TOKEN_LABELS.map(([key, label]) => (
              <div key={key} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <dt className="text-muted-foreground">{label}</dt>
                <dd className="tabular-nums">
                  {calibration.measuredTokens ? formatNumber(calibration.measuredTokens[key]) : "—"}{" "}
                  <span className="text-muted-foreground">
                    medido · {formatNumber(calibration.estimatedTokens[key])} estimado
                  </span>
                </dd>
              </div>
            ))}
          </dl>
        </div>
      </CardContent>
    </Card>
  )
}

function MatchBadge({ matches }: { matches: boolean }) {
  return matches ? (
    <Badge variant="secondary">
      <CircleCheckIcon data-icon="inline-start" />
      Confere
    </Badge>
  ) : (
    <Badge variant="destructive">
      <TriangleAlertIcon data-icon="inline-start" />
      Diferente
    </Badge>
  )
}

function usdPrice(value: number) {
  return `US$ ${formatNumber(value)}`
}

function modelPrices(prices: AiModelPriceSnapshot) {
  return `entrada ${usdPrice(prices.usdPerMtokInput)} · saída ${usdPrice(prices.usdPerMtokOutput)} · cache lido ${usdPrice(prices.usdPerMtokCacheRead)} · cache gravado ${usdPrice(prices.usdPerMtokCacheWrite)} (5 min) e ${usdPrice(prices.usdPerMtokCacheWrite1h)} (1 h)`
}

function modelLabel(model: string) {
  return isAiModel(model) ? AI_MODEL_CATALOG[model].label : model
}

const EFFORT_LABELS = { low: "effort baixo", medium: "effort médio", high: "effort alto" } as const

function PricingCard({
  pricing,
  typicalCosts,
}: {
  pricing: AiPricingCheck
  typicalCosts: AiTypicalUsageCost[]
}) {
  const rate = (value: number | null) =>
    value === null
      ? "—"
      : `R$ ${new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 4 }).format(value)}`
  const discount = (multiplier: number | null) =>
    multiplier === null ? "—" : formatAiRatio(1 - multiplier)

  return (
    <Card>
      <CardHeader>
        <CardTitle>Preço e câmbio em uso</CardTitle>
        <CardDescription>
          O banco (private.ai_models, private.ai_pricing e private.ai_cost_cap_cents) é quem mede e
          corta; o core (packages/core/src/billing/ai-usage.ts) é a fonte dos números e projeta os
          planos. Os dois precisam bater.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-6 text-sm">
        <dl className="flex flex-col divide-y">
          <div className="flex flex-wrap items-center justify-between gap-2 py-2">
            <dt className="text-muted-foreground">Câmbio da medição (US$ → R$)</dt>
            <dd className="flex flex-wrap items-center gap-2 tabular-nums">
              {rate(pricing.databaseExchangeRate)}
              <span className="text-muted-foreground">core {rate(pricing.coreExchangeRate)}</span>
              <MatchBadge matches={pricing.exchangeRateMatches} />
            </dd>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 py-2">
            <dt className="text-muted-foreground">Desconto da Batch API (em tudo)</dt>
            <dd className="flex flex-wrap items-center gap-2 tabular-nums">
              {discount(pricing.databaseBatchMultiplier)}
              <span className="text-muted-foreground">
                core {discount(pricing.coreBatchMultiplier)}
              </span>
              <MatchBadge matches={pricing.batchMultiplierMatches} />
            </dd>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 py-2">
            <dt className="text-muted-foreground">Chamada sem modelo informado</dt>
            <dd className="flex flex-wrap items-center gap-2">
              {pricing.databaseModel === null ? "—" : modelLabel(pricing.databaseModel)}
              <span className="text-muted-foreground">(o mais caro: nunca mede a menos)</span>
            </dd>
          </div>
        </dl>

        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-medium">Preço por milhão de tokens</h3>
          <ul className="flex flex-col divide-y">
            {pricing.models.map((model) => (
              <li key={model.model} className="flex min-w-0 flex-col gap-1 py-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium">{model.label}</span>
                  <MatchBadge matches={model.matches} />
                </div>
                <p className="break-words text-muted-foreground tabular-nums">
                  {model.database
                    ? modelPrices(model.database)
                    : "Não está no banco: chamadas com este modelo são recusadas."}
                </p>
                {!model.matches && model.core ? (
                  <p className="break-words text-muted-foreground tabular-nums">
                    core: {modelPrices(model.core)}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        </div>

        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-medium">Custo típico por tipo de uso (estimativa)</h3>
          <ul className="flex flex-col divide-y">
            {typicalCosts.map((cost) => (
              <li
                key={cost.kind}
                className="flex flex-wrap items-center justify-between gap-2 py-2"
              >
                <span className="flex min-w-0 flex-col">
                  <span>{AI_USAGE_KIND_LABELS[cost.kind]}</span>
                  <span className="text-xs text-muted-foreground">
                    {AI_MODEL_CATALOG[cost.model].label}
                    {cost.effort ? `, ${EFFORT_LABELS[cost.effort]}` : ", sem raciocínio"}
                  </span>
                </span>
                <span className="flex flex-col items-end tabular-nums">
                  {formatAiMillicents(cost.costMillicents)}
                  {cost.batchCostMillicents === null ? null : (
                    <span className="text-xs text-muted-foreground">
                      {formatAiMillicents(cost.batchCostMillicents)} em lote
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </div>

        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-medium">Teto de IA por plano</h3>
          <p className="text-xs text-muted-foreground">
            Máximo que cada imobiliária pode gastar por ciclo mensal — não é o gasto esperado. Ao
            bater o teto, a IA para. Regra: o menor entre {formatAiRatio(AI_COST_CAP_PCT)} do preço
            de tabela e a franquia × conversa típica × {formatNumber(AI_COST_CAP_FRANCHISE_SLACK)}.
            O teste grátis não tem IA.
          </p>
          <ul className="flex flex-col divide-y">
            {pricing.planCaps.map((cap) => (
              <li
                key={cap.planKey}
                className="flex flex-wrap items-center justify-between gap-2 py-2"
              >
                <span className="flex min-w-0 flex-col">
                  <span>{planLabel(cap.planKey)}</span>
                  {cap.databaseCents > 0 && cap.conversations !== null ? (
                    <span className="text-xs text-muted-foreground tabular-nums">
                      Franquia {formatNumber(cap.conversations)} · cabem{" "}
                      {formatNumber(cap.conversationsWithinCap)} conversas típicas
                    </span>
                  ) : null}
                </span>
                <span className="flex flex-wrap items-center gap-2 tabular-nums">
                  {cap.databaseCents === 0 ? "Sem IA" : `até ${formatBRL(cap.databaseCents)}`}
                  {cap.matches ? null : (
                    <span className="text-muted-foreground">
                      core {cap.coreCents === null ? "—" : formatBRL(cap.coreCents)}
                    </span>
                  )}
                  <MatchBadge matches={cap.matches} />
                </span>
              </li>
            ))}
          </ul>
        </div>
      </CardContent>
    </Card>
  )
}

/** Tela de custos de IA de um ciclo (só números). */
export function AiCostsOverview({
  snapshot,
  summary,
}: {
  snapshot: PlatformAiCostsSnapshot
  summary: AiCostSummary
}) {
  return (
    <>
      <CycleSwitch cycle={summary.cycle} />

      <SummaryCards summary={summary} snapshot={snapshot} />

      {summary.overWarning.length > 0 ? (
        <Alert variant="destructive">
          <TriangleAlertIcon />
          <AlertTitle>
            {summary.overWarning.length === 1
              ? "1 imobiliária passou de 80% do teto"
              : `${formatNumber(summary.overWarning.length)} imobiliárias passaram de 80% do teto`}
          </AlertTitle>
          <AlertDescription>
            <ul className="flex flex-col gap-1">
              {summary.overWarning.map((row) => (
                <li key={row.organizationId}>
                  {row.organizationName}: {formatAiRatio(row.capRatio)} (
                  {formatAiMillicents(row.usage.costMillicents)} de {formatBRL(row.capCents)})
                </li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Por imobiliária</CardTitle>
          <CardDescription>
            {summary.cycle === "atual"
              ? "Cada imobiliária tem o próprio ciclo, que vira no dia da assinatura."
              : "Último ciclo fechado de cada imobiliária. O teto mostrado é o do plano atual."}{" "}
            Custo exatamente como está em ai_usage_periods (inclui reservas ainda não acertadas).
          </CardDescription>
        </CardHeader>
        <CardContent>
          {summary.rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhum consumo de IA neste ciclo.</p>
          ) : (
            <ul className="flex flex-col divide-y">
              {summary.rows.map((row) => (
                <OrganizationRow key={row.organizationId} row={row} />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-6 xl:grid-cols-2">
        <CalibrationCard calibration={summary.calibration} />
        <PricingCard pricing={summary.pricing} typicalCosts={summary.typicalCosts} />
      </div>
    </>
  )
}

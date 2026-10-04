/**
 * Console da Plataforma — custos de IA.
 *
 * Leitura da resposta de `platform_ai_costs` (jsonb) e os cálculos da tela
 * /plataforma/custos-ia. Só números: tokens, conversas, requisições e custo em
 * millicents exatamente como estão em `ai_usage_periods`, contra o teto do plano.
 *
 * - Ciclo atual = o ciclo que a trava de IA usa agora; ciclo anterior = a última
 *   linha de consumo antes dele. O teto é sempre o do plano ATUAL (o banco não
 *   guarda histórico de plano por ciclo).
 * - "Conversa" é a unidade da franquia: uma janela de 24 h com o mesmo contato
 *   conta 1 e cada pedido avulso (anúncio, resumo, sugestão) conta o peso do
 *   tipo. O custo médio por conversa medido inclui os avulsos.
 * - A estimativa usada nos planos (AI_TYPICAL_CONVERSATION) é calculada com o
 *   câmbio do BANCO, o mesmo que gerou `cost_millicents`, para comparar igual
 *   com igual.
 * - O banco mede por modelo (Sonnet 5 e Haiku 4.5) e com desconto da Batch API;
 *   a conferência compara cada preço, o desconto do lote, o câmbio e o teto de
 *   cada plano com o core (packages/core/src/billing/ai-usage.ts, fonte única).
 */

import { z } from "zod"

import {
  AI_BATCH_PRICE_MULTIPLIER,
  AI_DEFAULT_MODEL,
  AI_EXCHANGE_RATE_DEFAULT,
  AI_MILLICENTS_PER_CENT,
  AI_MODEL_CATALOG,
  AI_MODELS,
  AI_USAGE_WARNING_RATIO,
  aiCostCapCents,
  aiTypicalUsageCosts,
  conversationsWithinCapCents,
  isAiModel,
  millicentsToCents,
  typicalConversationCostMillicents,
  typicalConversationTokens,
  type AiTypicalUsageCost,
} from "../billing/ai-usage"
import { isBillingPlanKey, isPlanKey, PLANS, TRIAL_LIMITS } from "../billing/plans"

// ---------------------------------------------------------------------------
// Leitura
// ---------------------------------------------------------------------------

export const AI_COST_CYCLES = ["atual", "anterior"] as const

export type AiCostCycle = (typeof AI_COST_CYCLES)[number]

export const AI_COST_CYCLE_LABELS: Record<AiCostCycle, string> = {
  atual: "Ciclo atual",
  anterior: "Ciclo anterior",
}

export function isAiCostCycle(value: unknown): value is AiCostCycle {
  return typeof value === "string" && (AI_COST_CYCLES as readonly string[]).includes(value)
}

export type AiUsageTotals = {
  conversations: number
  requests: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  costMillicents: number
}

export type AiCostPeriodUsage = AiUsageTotals & {
  periodStart: string
  periodEnd: string
}

export type AiCostOrganization = {
  organizationId: string
  organizationName: string
  planKey: string
  billingState: string
  /** Franquia de conversas do plano (-1 = ilimitada, 0 = sem IA). */
  conversationsLimit: number
  planCapCents: number
  /** Teto do plano + excedente autorizado. É o teto que bloqueia. */
  effectiveCapCents: number
  currentPeriodStart: string | null
  currentPeriodEnd: string | null
  current: AiCostPeriodUsage | null
  previous: AiCostPeriodUsage | null
}

export type AiPricingSnapshot = {
  /** Modelo padrão do banco (chamada sem modelo é medida nele). */
  model: string
  usdPerMtokInput: number
  usdPerMtokOutput: number
  usdPerMtokCacheRead: number
  usdPerMtokCacheWrite: number
  exchangeRate: number
  /** Multiplicador da Batch API (0,5); null em banco anterior à medição por modelo. */
  batchMultiplier: number | null
}

/** Preço de um modelo do catálogo do banco (private.ai_models). */
export type AiModelPriceSnapshot = {
  model: string
  label: string
  usdPerMtokInput: number
  usdPerMtokOutput: number
  usdPerMtokCacheRead: number
  usdPerMtokCacheWrite: number
  usdPerMtokCacheWrite1h: number
}

export type PlatformAiCostsSnapshot = {
  generatedAt: string | null
  pricing: AiPricingSnapshot | null
  /** Todos os modelos que o banco sabe medir; vazio em banco anterior à medição por modelo. */
  models: AiModelPriceSnapshot[]
  /** Teto do ciclo por plano no banco (private.ai_cost_cap_cents), em centavos. */
  planCapsCents: Record<string, number>
  organizationsTotal: number
  organizationsWithAi: number
  organizations: AiCostOrganization[]
}

const count = z.number().int().nonnegative()
const finite = z.number().refine(Number.isFinite)

const periodSchema = z.object({
  period_start: z.string(),
  period_end: z.string(),
  conversations: count,
  requests: count,
  input_tokens: count,
  output_tokens: count,
  cache_read_tokens: count,
  cache_write_tokens: count,
  cost_millicents: count,
})

const organizationSchema = z.object({
  organization_id: z.string(),
  organization_name: z.string(),
  plan_key: z.string(),
  billing_state: z.string(),
  conversations_limit: z.number().int(),
  plan_cap_cents: count,
  effective_cap_cents: count,
  current_period_start: z.string().nullable(),
  current_period_end: z.string().nullable(),
  current: periodSchema.nullable(),
  previous: periodSchema.nullable(),
})

const pricingSchema = z.object({
  model: z.string(),
  usd_per_mtok_input: finite,
  usd_per_mtok_output: finite,
  usd_per_mtok_cache_read: finite,
  usd_per_mtok_cache_write: finite,
  exchange_rate: finite,
  batch_multiplier: finite.nullable().optional(),
})

const modelSchema = z.object({
  model: z.string(),
  label: z.string(),
  usd_per_mtok_input: finite,
  usd_per_mtok_output: finite,
  usd_per_mtok_cache_read: finite,
  usd_per_mtok_cache_write: finite,
  usd_per_mtok_cache_write_1h: finite,
})

const snapshotSchema = z.object({
  generated_at: z.string().nullable().catch(null),
  pricing: pricingSchema.nullable().catch(null),
  models: z.array(modelSchema).catch([]),
  plan_caps_cents: z.record(z.string(), count).catch({}),
  organizations_total: count,
  organizations_with_ai: count,
  organizations: z.array(organizationSchema),
})

function toPeriod(period: z.infer<typeof periodSchema> | null): AiCostPeriodUsage | null {
  return period
    ? {
        periodStart: period.period_start,
        periodEnd: period.period_end,
        conversations: period.conversations,
        requests: period.requests,
        inputTokens: period.input_tokens,
        outputTokens: period.output_tokens,
        cacheReadTokens: period.cache_read_tokens,
        cacheWriteTokens: period.cache_write_tokens,
        costMillicents: period.cost_millicents,
      }
    : null
}

/** Resposta de `platform_ai_costs` → retrato tipado; null se o formato não bater. */
export function parsePlatformAiCosts(data: unknown): PlatformAiCostsSnapshot | null {
  const parsed = snapshotSchema.safeParse(data)

  if (!parsed.success) {
    return null
  }

  const { data: snapshot } = parsed

  return {
    generatedAt: snapshot.generated_at,
    pricing: snapshot.pricing
      ? {
          model: snapshot.pricing.model,
          usdPerMtokInput: snapshot.pricing.usd_per_mtok_input,
          usdPerMtokOutput: snapshot.pricing.usd_per_mtok_output,
          usdPerMtokCacheRead: snapshot.pricing.usd_per_mtok_cache_read,
          usdPerMtokCacheWrite: snapshot.pricing.usd_per_mtok_cache_write,
          exchangeRate: snapshot.pricing.exchange_rate,
          batchMultiplier: snapshot.pricing.batch_multiplier ?? null,
        }
      : null,
    models: snapshot.models.map((model) => ({
      model: model.model,
      label: model.label,
      usdPerMtokInput: model.usd_per_mtok_input,
      usdPerMtokOutput: model.usd_per_mtok_output,
      usdPerMtokCacheRead: model.usd_per_mtok_cache_read,
      usdPerMtokCacheWrite: model.usd_per_mtok_cache_write,
      usdPerMtokCacheWrite1h: model.usd_per_mtok_cache_write_1h,
    })),
    planCapsCents: snapshot.plan_caps_cents,
    organizationsTotal: snapshot.organizations_total,
    organizationsWithAi: snapshot.organizations_with_ai,
    organizations: snapshot.organizations.map((organization) => ({
      organizationId: organization.organization_id,
      organizationName: organization.organization_name,
      planKey: organization.plan_key,
      billingState: organization.billing_state,
      conversationsLimit: organization.conversations_limit,
      planCapCents: organization.plan_cap_cents,
      effectiveCapCents: organization.effective_cap_cents,
      currentPeriodStart: organization.current_period_start,
      currentPeriodEnd: organization.current_period_end,
      current: toPeriod(organization.current),
      previous: toPeriod(organization.previous),
    })),
  }
}

// ---------------------------------------------------------------------------
// Cálculos
// ---------------------------------------------------------------------------

/** Abaixo disso a média medida ainda não serve para recalibrar a estimativa. */
export const AI_COST_MIN_SAMPLE_CONVERSATIONS = 30

/** Diferença (para mais ou para menos) a partir da qual vale revisar a estimativa. */
export const AI_COST_CALIBRATION_TOLERANCE = 0.15

export const EMPTY_AI_USAGE: AiUsageTotals = {
  conversations: 0,
  requests: 0,
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  costMillicents: 0,
}

export function sumAiUsage(items: readonly AiUsageTotals[]): AiUsageTotals {
  return items.reduce<AiUsageTotals>(
    (total, item) => ({
      conversations: total.conversations + item.conversations,
      requests: total.requests + item.requests,
      inputTokens: total.inputTokens + item.inputTokens,
      outputTokens: total.outputTokens + item.outputTokens,
      cacheReadTokens: total.cacheReadTokens + item.cacheReadTokens,
      cacheWriteTokens: total.cacheWriteTokens + item.cacheWriteTokens,
      costMillicents: total.costMillicents + item.costMillicents,
    }),
    EMPTY_AI_USAGE
  )
}

/** Fração do teto usada; null quando não há teto (plano sem IA). */
export function aiCapRatio(costMillicents: number, capCents: number): number | null {
  const cap = capCents * AI_MILLICENTS_PER_CENT
  return cap > 0 ? Math.max(0, costMillicents) / cap : null
}

export type AiCostRow = {
  organizationId: string
  organizationName: string
  planKey: string
  billingState: string
  periodStart: string | null
  periodEnd: string | null
  usage: AiUsageTotals
  costCents: number
  capCents: number
  /** Fração do teto usada (1 = 100%); null sem teto. */
  capRatio: number | null
  /** Passou de 80% do teto (o mesmo limiar do aviso por e-mail). */
  overWarning: boolean
  /** Custo médio por conversa desta imobiliária; null sem conversa. */
  costPerConversationMillicents: number | null
}

export type AiTokensPerConversation = {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
}

export type AiConversationCalibrationStatus =
  "sem_dados" | "amostra_pequena" | "acima" | "abaixo" | "dentro"

export type AiConversationCalibration = {
  status: AiConversationCalibrationStatus
  conversations: number
  /** Custo médio medido por conversa (millicents); null sem conversa. */
  measuredMillicents: number | null
  /** Conversa típica do core ao câmbio do banco (millicents). */
  estimatedMillicents: number
  /** medido / estimado - 1 (0,2 = 20% mais caro que a estimativa); null sem conversa. */
  deviation: number | null
  measuredTokens: AiTokensPerConversation | null
  estimatedTokens: AiTokensPerConversation
  message: string
}

export type AiPlanCapCheck = {
  planKey: string
  /** Teto do ciclo mensal por imobiliária no banco: o MÁXIMO que ele deixa gastar. */
  databaseCents: number
  coreCents: number | null
  matches: boolean
  /** Franquia de conversas do plano no core (0 = sem IA); null para plano desconhecido. */
  conversations: number | null
  /** Quantas conversas típicas cabem no teto do banco, ao câmbio do banco. */
  conversationsWithinCap: number
}

export type AiModelPriceCheck = {
  model: string
  label: string
  database: AiModelPriceSnapshot | null
  /** Preço do core no mesmo formato; null quando o modelo não existe no core. */
  core: AiModelPriceSnapshot | null
  matches: boolean
}

export type AiPricingCheck = {
  /** Modelo que o banco assume quando a chamada não informa. */
  databaseModel: string | null
  coreModel: string
  /** Câmbio que a medição usa de fato (private.ai_pricing). */
  databaseExchangeRate: number | null
  coreExchangeRate: number
  exchangeRateMatches: boolean
  /** Multiplicador da Batch API no banco e no core (0,5 = 50% de desconto). */
  databaseBatchMultiplier: number | null
  coreBatchMultiplier: number
  batchMultiplierMatches: boolean
  /** Todos os modelos do core existem no banco com o mesmo preço, e vice-versa. */
  pricesMatch: boolean
  models: AiModelPriceCheck[]
  planCaps: AiPlanCapCheck[]
}

export type AiCostSummary = {
  cycle: AiCostCycle
  rows: AiCostRow[]
  totals: AiUsageTotals
  totalCostCents: number
  /** Soma dos tetos das imobiliárias com consumo no ciclo. */
  totalCapCents: number
  totalCapRatio: number | null
  overWarning: AiCostRow[]
  calibration: AiConversationCalibration
  pricing: AiPricingCheck
  /** Custo típico de cada tipo de uso no modelo do perfil, ao câmbio do banco (estimativa). */
  typicalCosts: AiTypicalUsageCost[]
}

function roundRatio(value: number): number {
  return Math.round(value * 10_000) / 10_000
}

function perConversation(usage: AiUsageTotals): AiTokensPerConversation | null {
  if (usage.conversations <= 0) {
    return null
  }

  return {
    inputTokens: Math.round(usage.inputTokens / usage.conversations),
    outputTokens: Math.round(usage.outputTokens / usage.conversations),
    cacheReadTokens: Math.round(usage.cacheReadTokens / usage.conversations),
    cacheWriteTokens: Math.round(usage.cacheWriteTokens / usage.conversations),
  }
}

function usageFor(organization: AiCostOrganization, cycle: AiCostCycle): AiCostPeriodUsage | null {
  return cycle === "atual" ? organization.current : organization.previous
}

/** Linha de uma imobiliária no ciclo; null quando ela não teve consumo nele. */
export function buildAiCostRow(
  organization: AiCostOrganization,
  cycle: AiCostCycle
): AiCostRow | null {
  const period = usageFor(organization, cycle)

  if (!period) {
    return null
  }

  const usage: AiUsageTotals = {
    conversations: period.conversations,
    requests: period.requests,
    inputTokens: period.inputTokens,
    outputTokens: period.outputTokens,
    cacheReadTokens: period.cacheReadTokens,
    cacheWriteTokens: period.cacheWriteTokens,
    costMillicents: period.costMillicents,
  }
  const capRatio = aiCapRatio(usage.costMillicents, organization.effectiveCapCents)

  return {
    organizationId: organization.organizationId,
    organizationName: organization.organizationName,
    planKey: organization.planKey,
    billingState: organization.billingState,
    periodStart: period.periodStart,
    periodEnd: period.periodEnd,
    usage,
    costCents: millicentsToCents(usage.costMillicents),
    capCents: organization.effectiveCapCents,
    capRatio: capRatio === null ? null : roundRatio(capRatio),
    overWarning: capRatio !== null && capRatio >= AI_USAGE_WARNING_RATIO,
    costPerConversationMillicents:
      usage.conversations > 0 ? Math.round(usage.costMillicents / usage.conversations) : null,
  }
}

function percent(value: number): string {
  return `${Math.round(Math.abs(value) * 100)}%`
}

/** Custo médio medido por conversa x conversa típica estimada no core. */
export function calibrateAiConversation(
  totals: AiUsageTotals,
  exchangeRate: number = AI_EXCHANGE_RATE_DEFAULT
): AiConversationCalibration {
  const estimatedMillicents = typicalConversationCostMillicents(exchangeRate)
  const typical = typicalConversationTokens()
  const estimatedTokens: AiTokensPerConversation = {
    inputTokens: typical.inputTokens,
    outputTokens: typical.outputTokens,
    cacheReadTokens: typical.cacheReadTokens,
    cacheWriteTokens: typical.cacheWriteTokens,
  }
  const conversations = totals.conversations

  if (conversations <= 0) {
    return {
      status: "sem_dados",
      conversations: 0,
      measuredMillicents: null,
      estimatedMillicents,
      deviation: null,
      measuredTokens: null,
      estimatedTokens,
      message: "Nenhuma conversa medida neste ciclo: ainda não dá para comparar com a estimativa.",
    }
  }

  const measuredMillicents = Math.round(totals.costMillicents / conversations)
  const deviation =
    estimatedMillicents > 0 ? roundRatio(measuredMillicents / estimatedMillicents - 1) : null
  const base = {
    conversations,
    measuredMillicents,
    estimatedMillicents,
    deviation,
    measuredTokens: perConversation(totals),
    estimatedTokens,
  }

  if (conversations < AI_COST_MIN_SAMPLE_CONVERSATIONS) {
    return {
      ...base,
      status: "amostra_pequena",
      message: `Só ${conversations} ${conversations === 1 ? "conversa medida" : "conversas medidas"}: espere pelo menos ${AI_COST_MIN_SAMPLE_CONVERSATIONS} antes de mexer na estimativa.`,
    }
  }

  if (deviation !== null && deviation > AI_COST_CALIBRATION_TOLERANCE) {
    return {
      ...base,
      status: "acima",
      message: `A conversa real custa ${percent(deviation)} a mais que a estimativa. Revise AI_TYPICAL_CONVERSATION (packages/core/src/billing/ai-usage.ts) e os tetos: a margem pode estar menor do que a tabela de planos supõe.`,
    }
  }

  if (deviation !== null && deviation < -AI_COST_CALIBRATION_TOLERANCE) {
    return {
      ...base,
      status: "abaixo",
      message: `A conversa real custa ${percent(deviation)} a menos que a estimativa. Dá para recalibrar AI_TYPICAL_CONVERSATION para baixo com segurança.`,
    }
  }

  return {
    ...base,
    status: "dentro",
    message: `A conversa real está a até ${percent(AI_COST_CALIBRATION_TOLERANCE)} da estimativa: nada a recalibrar.`,
  }
}

function coreModelPrice(model: string): AiModelPriceSnapshot | null {
  if (!isAiModel(model)) {
    return null
  }

  const { label, priceUsdPerMtok: price } = AI_MODEL_CATALOG[model]

  return {
    model,
    label,
    usdPerMtokInput: price.input,
    usdPerMtokOutput: price.output,
    usdPerMtokCacheRead: price.cacheRead,
    usdPerMtokCacheWrite: price.cacheWrite,
    usdPerMtokCacheWrite1h: price.cacheWrite1h,
  }
}

function samePrice(a: AiModelPriceSnapshot | null, b: AiModelPriceSnapshot | null): boolean {
  return (
    a !== null &&
    b !== null &&
    a.model === b.model &&
    a.usdPerMtokInput === b.usdPerMtokInput &&
    a.usdPerMtokOutput === b.usdPerMtokOutput &&
    a.usdPerMtokCacheRead === b.usdPerMtokCacheRead &&
    a.usdPerMtokCacheWrite === b.usdPerMtokCacheWrite &&
    a.usdPerMtokCacheWrite1h === b.usdPerMtokCacheWrite1h
  )
}

/** Franquia de conversas do plano no core (o teste grátis vem de TRIAL_LIMITS). */
function planConversations(planKey: string): number | null {
  if (planKey === "trial") {
    return TRIAL_LIMITS.ai_conversations
  }

  return isPlanKey(planKey) ? PLANS[planKey].limits.ai_conversations : null
}

/** Confere o espelho banco x core: modelos, preços, lote, câmbio e teto por plano. */
export function checkAiPricing(snapshot: PlatformAiCostsSnapshot): AiPricingCheck {
  const pricing = snapshot.pricing
  const rate = pricing?.exchangeRate ?? AI_EXCHANGE_RATE_DEFAULT
  const planCaps = Object.entries(snapshot.planCapsCents)
    .map(([planKey, databaseCents]) => {
      const coreCents = isBillingPlanKey(planKey) ? aiCostCapCents(planKey) : null

      return {
        planKey,
        databaseCents,
        coreCents,
        matches: coreCents === databaseCents,
        conversations: planConversations(planKey),
        conversationsWithinCap: conversationsWithinCapCents(databaseCents, rate),
      }
    })
    .sort((a, b) => a.databaseCents - b.databaseCents || a.planKey.localeCompare(b.planKey))

  // Modelos do core primeiro (na ordem do catálogo), depois os que só o banco tem.
  const databaseModels = new Map(snapshot.models.map((model) => [model.model, model]))
  const modelKeys = [
    ...AI_MODELS,
    ...snapshot.models.map((model) => model.model).filter((model) => !isAiModel(model)),
  ]
  const models = modelKeys.map((model) => {
    const database = databaseModels.get(model) ?? null
    const core = coreModelPrice(model)

    return {
      model,
      label: core?.label ?? database?.label ?? model,
      database,
      core,
      matches: samePrice(database, core),
    }
  })

  return {
    databaseModel: pricing?.model ?? null,
    coreModel: AI_DEFAULT_MODEL,
    databaseExchangeRate: pricing?.exchangeRate ?? null,
    coreExchangeRate: AI_EXCHANGE_RATE_DEFAULT,
    exchangeRateMatches: pricing?.exchangeRate === AI_EXCHANGE_RATE_DEFAULT,
    databaseBatchMultiplier: pricing?.batchMultiplier ?? null,
    coreBatchMultiplier: AI_BATCH_PRICE_MULTIPLIER,
    batchMultiplierMatches: pricing?.batchMultiplier === AI_BATCH_PRICE_MULTIPLIER,
    pricesMatch:
      pricing !== null &&
      pricing.model === AI_DEFAULT_MODEL &&
      models.every((model) => model.matches),
    models,
    planCaps,
  }
}

/** Tudo o que a tela mostra para um ciclo. */
export function summarizeAiCosts(
  snapshot: PlatformAiCostsSnapshot,
  cycle: AiCostCycle
): AiCostSummary {
  const rows = snapshot.organizations
    .map((organization) => buildAiCostRow(organization, cycle))
    .filter((row): row is AiCostRow => row !== null)
    .sort(
      (a, b) =>
        b.usage.costMillicents - a.usage.costMillicents ||
        a.organizationName.localeCompare(b.organizationName, "pt-BR")
    )

  const totals = sumAiUsage(rows.map((row) => row.usage))
  const totalCapCents = rows.reduce((sum, row) => sum + row.capCents, 0)
  const totalCapRatio = aiCapRatio(totals.costMillicents, totalCapCents)

  return {
    cycle,
    rows,
    totals,
    totalCostCents: millicentsToCents(totals.costMillicents),
    totalCapCents,
    totalCapRatio: totalCapRatio === null ? null : roundRatio(totalCapRatio),
    overWarning: rows
      .filter((row) => row.overWarning)
      .sort((a, b) => (b.capRatio ?? 0) - (a.capRatio ?? 0)),
    calibration: calibrateAiConversation(
      totals,
      snapshot.pricing?.exchangeRate ?? AI_EXCHANGE_RATE_DEFAULT
    ),
    pricing: checkAiPricing(snapshot),
    typicalCosts: aiTypicalUsageCosts(snapshot.pricing?.exchangeRate ?? AI_EXCHANGE_RATE_DEFAULT),
  }
}

/**
 * Millicents → "R$ 0,55" (ou "R$ 0,0042" abaixo de um centavo, para o custo por
 * conversa não virar "R$ 0,00"). Espaço comum no lugar do não separável.
 */
export function formatAiMillicents(millicents: number): string {
  const safe = Number.isFinite(millicents) ? Math.max(0, millicents) : 0
  const reais = safe / (AI_MILLICENTS_PER_CENT * 100)
  const fractionDigits = safe > 0 && safe < AI_MILLICENTS_PER_CENT ? 4 : 2

  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  })
    .format(reais)
    .replace(/\s/g, " ")
}

/** Fração → "83%" (uma casa abaixo de 10%). */
export function formatAiRatio(ratio: number | null): string {
  if (ratio === null || !Number.isFinite(ratio)) {
    return "—"
  }

  const value = ratio * 100
  const digits = value > 0 && value < 10 ? 1 : 0

  return `${new Intl.NumberFormat("pt-BR", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value)}%`
}

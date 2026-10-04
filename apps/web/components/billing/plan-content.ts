// Cálculos de exibição dos planos que dependem do catálogo da Stripe.
// Puro (sem server-only): roda no servidor e no navegador. Catálogo, limites,
// benefícios e textos vêm do core (`@workspace/core/billing`), a fonte única.
import {
  addonLookupKey,
  AI_PLAN_NOTE,
  BILLING_INTERVAL_LABELS,
  formatBRL,
  LISTING_PHOTO_MAX_MB,
  maxExtraSeats,
  OWNED_LISTINGS_ADDON_KEY,
  OWNED_LISTINGS_PACK_PRICE,
  PLAN_KEYS,
  PLANS,
  priceLookupKey,
  seatLookupKey,
  type BillingInterval,
  type PlanBenefit,
  type PlanKey,
} from "@workspace/core/billing"

import { SIGN_UP_PATH } from "@/lib/auth/routes"

/** Preços por `lookup_key`, em centavos (ver getCatalogPrices). */
export type CatalogPrices = Record<string, number>

export type PlanPricing = {
  /** Preço do plano no intervalo, em centavos. */
  price: number
  /** Preço de cada usuário extra no intervalo, em centavos. */
  seatPrice: number
}

function isCents(value: number | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
}

/** Preço do catálogo da Stripe; sem ele (ou inválido), o preço do core. */
export function resolvePlanPricing(
  prices: CatalogPrices,
  plan: PlanKey,
  interval: BillingInterval
): PlanPricing {
  const price = prices[priceLookupKey(plan, interval)]
  const seatPrice = prices[seatLookupKey(plan, interval)]

  return {
    price: isCents(price) ? price : PLANS[plan].prices[interval],
    seatPrice: isCents(seatPrice) ? seatPrice : PLANS[plan].seatPrice[interval],
  }
}

/** Preço de um pacote de +10 imóveis no intervalo: Stripe quando houver, senão o core. */
export function resolvePackPrice(prices: CatalogPrices, interval: BillingInterval): number {
  const price = prices[addonLookupKey(OWNED_LISTINGS_ADDON_KEY, interval)]
  return isCents(price) ? price : OWNED_LISTINGS_PACK_PRICE[interval]
}

/** Total do intervalo com os usuários extras, em centavos. */
export function totalWithSeats(pricing: PlanPricing, extraSeats: number): number {
  return pricing.price + pricing.seatPrice * extraSeats
}

const integer = new Intl.NumberFormat("pt-BR")

export function pluralize(count: number, singular: string, plural: string) {
  return `${integer.format(count)} ${count === 1 ? singular : plural}`
}

/**
 * Benefícios-chave do cartão: os do core, sem a linha de usuários (o cartão
 * mostra usuários e preço do extra no intervalo e no catálogo escolhidos).
 */
export function keyBenefits(plan: PlanKey, max = Number.POSITIVE_INFINITY): PlanBenefit[] {
  return PLANS[plan].benefits.filter((benefit) => !/usuári/i.test(benefit.text)).slice(0, max)
}

/** Plano imediatamente abaixo na ordem do catálogo; null no primeiro. */
export function previousPlan(plan: PlanKey): PlanKey | null {
  const index = PLAN_KEYS.indexOf(plan)
  return index > 0 ? (PLAN_KEYS[index - 1] ?? null) : null
}

/**
 * Benefícios que o plano acrescenta ao anterior ("Tudo do plano X, mais:"): os
 * do core cujo texto não aparece no plano de baixo. Números que mudam (imóveis
 * com foto, conversas de IA, suporte) contam como item novo.
 */
export function planIncrements(plan: PlanKey): PlanBenefit[] {
  const previous = previousPlan(plan)

  if (!previous) {
    return keyBenefits(plan)
  }

  const inherited = new Set(keyBenefits(previous).map((benefit) => benefit.text))
  return keyBenefits(plan).filter((benefit) => !inherited.has(benefit.text))
}

/** Preço mensal equivalente (no anual, o total dividido por 12), em centavos. */
export function monthlyEquivalent(pricing: PlanPricing, interval: BillingInterval) {
  return interval === "year" ? Math.round(pricing.price / 12) : pricing.price
}

/** "R$" seguido de espaço inseparável (código 160). */
const NBSP_PREFIX = `R$${String.fromCharCode(160)}`

/** Usuários incluídos e preço do extra, no intervalo escolhido. */
export function seatsSummary(plan: PlanKey, pricing: PlanPricing, interval: BillingInterval) {
  const details = PLANS[plan]
  const maxExtra = maxExtraSeats(plan)
  const included = pluralize(details.usersIncluded, "usuário incluído", "usuários incluídos")
  // O valor não quebra de linha longe do símbolo.
  const price = formatBRL(pricing.seatPrice, { omitZeroCents: true }).replace(
    /^R\$\s+/,
    NBSP_PREFIX
  )
  const seatPrice = `${price}${BILLING_INTERVAL_LABELS[interval].suffix}`

  if (maxExtra === 0) {
    return `${included}.`
  }

  return Number.isFinite(maxExtra)
    ? `${included}; até ${pluralize(maxExtra, "extra", "extras")} por ${seatPrice} cada.`
    : `${included}; usuário extra por ${seatPrice}.`
}

/** Notas de uso e limites do rodapé do cartão (só regras do catálogo). */
export function planFootnotes(plan: PlanKey): string[] {
  const details = PLANS[plan]
  const notes = [
    details.usersMax === -1
      ? "Sem teto de usuários extras."
      : `No máximo ${pluralize(details.usersMax, "pessoa", "pessoas")} no total.`,
    `Até ${details.limits.photos_per_listing} fotos por imóvel, com ${LISTING_PHOTO_MAX_MB} MB cada.`,
  ]

  if (details.limits.ai_conversations === 0) {
    notes.push(`${AI_PLAN_NOTE}.`)
  }

  return notes
}

/** CTA de venda: cadastro com o plano pré-escolhido. */
export function signUpHref(plan: PlanKey) {
  return `${SIGN_UP_PATH}?${new URLSearchParams({ plano: plan }).toString()}`
}

// ---------------------------------------------------------------------------
// Economia do plano anual
//
// Decisão do dono (17/09/2026): a vitrine NÃO mostra preço antigo riscado. Um
// reajuste não é desconto, e "de R$ X por R$ Y" com preço que ninguém paga mais
// é publicidade enganosa. O que a tela destaca é a economia REAL de quem paga
// adiantado, sempre contra o preço mensal VIGENTE: 12 meses de uso pelo preço de
// 10 mensalidades. Nenhum número aqui é escrito à mão — todos saem de PLANS ou
// do catálogo da Stripe resolvido em resolvePlanPricing.

export const MONTHS_IN_YEAR = 12

export type AnnualSavings = {
  /** 12 meses pagos mês a mês, em centavos. */
  monthlyPerYear: number
  /** O ano todo cobrado de uma vez, em centavos. */
  yearlyTotal: number
  /** monthlyPerYear − yearlyTotal, em centavos; 0 quando o anual não é mais barato. */
  savings: number
  /** Quanto o anual sai por mês, em centavos. */
  monthlyEquivalent: number
  /** Mensalidades cobradas no ano (hoje 10); null quando a conta não fecha redonda. */
  paidMonths: number | null
  /** Meses que saem de graça (hoje 2); null junto com paidMonths. */
  freeMonths: number | null
}

/**
 * Economia do anual a partir dos dois totais já resolvidos (Stripe ou core).
 * Só promete "X mensalidades" quando o anual é múltiplo exato do mensal: se
 * alguém mudar a regra, o texto cai para a versão sem número em vez de mentir.
 */
export function annualSavings(monthlyTotal: number, yearlyTotal: number): AnnualSavings {
  const monthlyPerYear = monthlyTotal * MONTHS_IN_YEAR
  const ratio = monthlyTotal > 0 ? yearlyTotal / monthlyTotal : Number.NaN
  const paidMonths = Number.isInteger(ratio) && ratio > 0 && ratio < MONTHS_IN_YEAR ? ratio : null

  return {
    monthlyPerYear,
    yearlyTotal,
    savings: Math.max(0, monthlyPerYear - yearlyTotal),
    monthlyEquivalent: Math.round(yearlyTotal / MONTHS_IN_YEAR),
    paidMonths,
    freeMonths: paidMonths === null ? null : MONTHS_IN_YEAR - paidMonths,
  }
}

/** Economia do anual de um plano, já com usuários extras e pacotes de imóveis. */
export function planAnnualSavings(
  prices: CatalogPrices,
  plan: PlanKey,
  extraSeats = 0,
  packs = 0
): AnnualSavings {
  const monthly =
    totalWithSeats(resolvePlanPricing(prices, plan, "month"), extraSeats) +
    resolvePackPrice(prices, "month") * packs
  const yearly =
    totalWithSeats(resolvePlanPricing(prices, plan, "year"), extraSeats) +
    resolvePackPrice(prices, "year") * packs

  return annualSavings(monthly, yearly)
}

/** "12 meses de uso pelo preço de 10 mensalidades", com o número do próprio cálculo. */
export function annualRuleText(savings: AnnualSavings): string {
  return savings.paidMonths === null
    ? `${MONTHS_IN_YEAR} meses de uso com o ano pago à vista`
    : `${MONTHS_IN_YEAR} meses de uso pelo preço de ${pluralize(savings.paidMonths, "mensalidade", "mensalidades")}`
}

export type PlanAnnualSavings = { plan: PlanKey; savings: AnnualSavings }

/** Economia do anual declarada no catálogo do core, plano a plano (só as > 0). */
export const CATALOG_ANNUAL_SAVINGS: readonly PlanAnnualSavings[] = PLAN_KEYS.map((plan) => ({
  plan,
  savings: annualSavings(PLANS[plan].prices.month, PLANS[plan].prices.year),
})).filter((entry) => entry.savings.savings > 0)

/**
 * Meses grátis do anual quando a regra vale para TODOS os planos (hoje 2).
 * null se algum plano fugir da regra: aí nenhum texto promete mês grátis.
 */
const catalogFreeMonths = new Set(CATALOG_ANNUAL_SAVINGS.map((entry) => entry.savings.freeMonths))

export const ANNUAL_FREE_MONTHS: number | null =
  CATALOG_ANNUAL_SAVINGS.length === PLAN_KEYS.length && catalogFreeMonths.size === 1
    ? ([...catalogFreeMonths][0] ?? null)
    : null

export const ANNUAL_PAID_MONTHS: number | null =
  ANNUAL_FREE_MONTHS === null ? null : MONTHS_IN_YEAR - ANNUAL_FREE_MONTHS

/** "você paga 10 mensalidades e usa 12 meses" — sem o número quando a regra varia. */
export const ANNUAL_RULE_SENTENCE =
  ANNUAL_PAID_MONTHS === null
    ? `você paga o ano à vista e usa ${MONTHS_IN_YEAR} meses`
    : `você paga ${pluralize(ANNUAL_PAID_MONTHS, "mensalidade", "mensalidades")} e usa ${MONTHS_IN_YEAR} meses`

/** Extremos da economia anual entre planos, para textos de faixa; null sem economia. */
export function annualSavingsRange(
  entries: readonly PlanAnnualSavings[]
): { min: PlanAnnualSavings; max: PlanAnnualSavings } | null {
  const sorted = entries
    .filter((entry) => entry.savings.savings > 0)
    .sort((a, b) => a.savings.savings - b.savings.savings)
  const min = sorted[0]
  const max = sorted[sorted.length - 1]

  return min && max ? { min, max } : null
}

/** "R$ 230" quando a economia é igual em todos, "R$ 230 a R$ 3.860" quando varia. */
export function formatAnnualSavingsRange(range: {
  min: PlanAnnualSavings
  max: PlanAnnualSavings
}): string {
  const min = formatBRL(range.min.savings.savings, { omitZeroCents: true })
  const max = formatBRL(range.max.savings.savings, { omitZeroCents: true })

  return min === max ? min : `${min} a ${max}`
}

// Recomendador de /planos: pessoas e imóveis com foto → plano, assentos extras e custo.
//
// Regra única, explicável e sem empurrar plano caro: entre os planos que
// ATENDEM o que foi informado, vence o de MENOR custo total (plano + usuários
// extras). "Atender" é o que o banco realmente aplica hoje:
//   · usuários: cabe no teto do plano (usersMax; o Corretor vai até 2);
//   · imóveis com foto: cabe no limite `owned_listings` do plano.
// Recurso "em breve" (IA, locação, funis) não entra na conta: recomendar um
// plano mais caro por algo que ainda não existe seria vender o que não entrega.
//
// Se nenhum plano comporta os imóveis com foto informados, fica o de maior
// limite de imóveis (desempate pelo menor custo) e `fitsOwnedListings` = false.
// Empate de custo leva o plano maior, que inclui mais pelo mesmo preço.
// Valores em centavos; o anual custa 10 mensalidades em todos os planos, então a
// ordem de custo é a mesma no mensal e no anual.

import { formatBRL } from "./format"
import {
  OWNED_LISTING_RELEASED_STATUS_PLURAL_TEXT,
  OWNED_LISTINGS_PACK_PRICE,
  OWNED_LISTINGS_PACK_SIZE,
  PLAN_KEYS,
  PLANS,
  planTotal,
  type PlanKey,
} from "./plans"

export type RecommendPlanInput = {
  /** Pessoas que vão usar o CRM. */
  teamSize: number
  /** Imóveis à venda ou para alugar com fotos hospedadas por nós. */
  ownedListings: number
}

export type PlanRecommendation = {
  plan: PlanKey
  extraSeats: number
  /** Centavos por mês no plano mensal (plano + extras). */
  monthlyTotal: number
  /** Centavos por ano no plano anual (plano + extras). */
  yearlyTotal: number
  /** Centavos economizados no anual contra 12 mensalidades. */
  yearlySavings: number
  /** false quando nenhum plano comporta os imóveis com foto informados. */
  fitsOwnedListings: boolean
  /** Motivos em pt-BR, na ordem em que foram decididos. */
  reasons: string[]
}

type Candidate = { plan: PlanKey; extraSeats: number; monthlyTotal: number }

function rank(plan: PlanKey): number {
  return PLAN_KEYS.indexOf(plan)
}

function normalizeCount(value: number, minimum: number): number {
  return Number.isFinite(value) ? Math.max(minimum, Math.ceil(value)) : minimum
}

function fitsUsers(plan: PlanKey, teamSize: number): boolean {
  const { usersMax } = PLANS[plan]
  return usersMax < 0 || teamSize <= usersMax
}

function fitsListings(plan: PlanKey, ownedListings: number): boolean {
  const limit = PLANS[plan].limits.owned_listings
  return limit < 0 || ownedListings <= limit
}

function listingLimit(plan: PlanKey): number {
  const limit = PLANS[plan].limits.owned_listings
  return limit < 0 ? Number.POSITIVE_INFINITY : limit
}

function toCandidate(plan: PlanKey, teamSize: number): Candidate {
  const extraSeats = Math.max(0, teamSize - PLANS[plan].usersIncluded)
  return { plan, extraSeats, monthlyTotal: planTotal(plan, "month", extraSeats) }
}

/** Menor custo; empate leva o plano maior. */
function cheapest(candidates: readonly Candidate[]): Candidate | undefined {
  return candidates.reduce<Candidate | undefined>((best, candidate) => {
    if (!best || candidate.monthlyTotal < best.monthlyTotal) return candidate
    if (candidate.monthlyTotal === best.monthlyTotal && rank(candidate.plan) > rank(best.plan)) {
      return candidate
    }
    return best
  }, undefined)
}

function people(count: number) {
  return count === 1 ? "1 pessoa" : `${count} pessoas`
}

function listings(count: number) {
  if (count === 0) return "nenhum imóvel com foto"
  return count === 1 ? "até 1 imóvel com foto" : `até ${count} imóveis com foto`
}

export function recommendPlan(input: RecommendPlanInput): PlanRecommendation {
  const teamSize = normalizeCount(input.teamSize, 1)
  const ownedListings = normalizeCount(input.ownedListings, 0)
  const reasons: string[] = []

  const byUsers = PLAN_KEYS.filter((plan) => fitsUsers(plan, teamSize)).map((plan) =>
    toCandidate(plan, teamSize)
  )
  const fitting = byUsers.filter((candidate) => fitsListings(candidate.plan, ownedListings))
  const fitsOwnedListings = fitting.length > 0

  // O Rede não tem teto de usuários: `byUsers` nunca fica vazio, e ele é o fallback.
  const largestLimit = Math.max(...byUsers.map((candidate) => listingLimit(candidate.plan)))
  const pool = fitsOwnedListings
    ? fitting
    : byUsers.filter((candidate) => listingLimit(candidate.plan) === largestLimit)
  const chosen = cheapest(pool) ?? toCandidate("rede", teamSize)
  const { plan, extraSeats } = chosen
  const name = PLANS[plan].name

  if (fitsOwnedListings) {
    reasons.push(
      `Para ${people(teamSize)} e ${listings(ownedListings)}, o plano ${name} é o de menor custo que atende.`
    )

    // Transparência: o plano mais barato para a equipe ficou de fora por causa dos imóveis.
    const cheapestForUsers = cheapest(byUsers)
    if (
      cheapestForUsers &&
      cheapestForUsers.plan !== plan &&
      !fitsListings(cheapestForUsers.plan, ownedListings)
    ) {
      reasons.push(
        `O plano ${PLANS[cheapestForUsers.plan].name} sairia mais barato, mas comporta só ${PLANS[cheapestForUsers.plan].limits.owned_listings} imóveis com foto.`
      )
    }
  } else {
    const packs = Math.ceil(
      (ownedListings - PLANS[plan].limits.owned_listings) / OWNED_LISTINGS_PACK_SIZE
    )
    reasons.push(
      `Nenhum plano comporta sozinho mais de ${PLANS[plan].limits.owned_listings} imóveis com foto. O plano ${name} é o que mais comporta; para o restante, some ${packs === 1 ? "1 pacote" : `${packs} pacotes`} de +${OWNED_LISTINGS_PACK_SIZE} imóveis por ${formatBRL(packs * OWNED_LISTINGS_PACK_PRICE.month, { omitZeroCents: true })}/mês.`
    )
  }

  reasons.push(
    `Imóveis sem foto, só com fotos hospedadas no site de origem, ${OWNED_LISTING_RELEASED_STATUS_PLURAL_TEXT} não contam no limite.`
  )

  if (extraSeats > 0) {
    reasons.push(
      extraSeats === 1
        ? `Inclui 1 usuário extra além dos ${PLANS[plan].usersIncluded} do plano.`
        : `Inclui ${extraSeats} usuários extras além dos ${PLANS[plan].usersIncluded} do plano.`
    )
  }

  const monthlyTotal = planTotal(plan, "month", extraSeats)
  const yearlyTotal = planTotal(plan, "year", extraSeats)

  return {
    plan,
    extraSeats,
    monthlyTotal,
    yearlyTotal,
    yearlySavings: monthlyTotal * 12 - yearlyTotal,
    fitsOwnedListings,
    reasons,
  }
}

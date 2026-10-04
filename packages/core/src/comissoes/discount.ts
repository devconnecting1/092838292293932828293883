// Aprovação de desconto: quanto a proposta está abaixo do preço anunciado e se
// isso passa do limite que a imobiliária configurou.
//
// Mesma conta do gatilho `private.proposals_require_discount_approval`: o
// desconto é medido em MILÉSIMOS de ponto percentual sobre o preço de tabela do
// imóvel (venda: `sale_price`; locação: `rent_price`) e o limite é comparado
// com `>`: desconto exatamente igual ao limite passa sem aprovação.
//
// O desconto é arredondado PARA CIMA (a favor da trava): 10,0001% com limite de
// 10% pede aprovação, e com limite zero qualquer centavo de desconto pede.

import { FULL_PERCENT, PERCENT_SCALE, safeCents, toMilliPercent } from "./rules"

export type DiscountPolicy = {
  /** Com `false`, nenhuma proposta trava por desconto. */
  approvalEnabled: boolean
  /** Desconto máximo que o corretor dá sozinho, em pontos percentuais. */
  maxDiscountPercent: number
}

export const DEFAULT_DISCOUNT_POLICY: DiscountPolicy = {
  approvalEnabled: false,
  maxDiscountPercent: 10,
}

/**
 * Desconto da proposta em milésimos de ponto percentual, arredondado para cima.
 * Zero quando não há preço de tabela ou quando a proposta é igual ou maior que
 * ele.
 */
export function discountMilli(referenceCents: number, amountCents: number): number {
  const reference = safeCents(referenceCents)
  const amount = safeCents(amountCents)

  if (reference <= 0 || amount >= reference) {
    return 0
  }

  const numerator = BigInt(reference - amount) * BigInt(FULL_PERCENT)
  const denominator = BigInt(reference)

  return Number((numerator + denominator - 1n) / denominator)
}

/** Desconto da proposta em pontos percentuais (3 casas). */
export function discountPercent(referenceCents: number, amountCents: number): number {
  return discountMilli(referenceCents, amountCents) / PERCENT_SCALE
}

/**
 * Verdadeiro quando a proposta precisa da aprovação do gerente para seguir.
 * Sem preço de tabela no imóvel não há como medir desconto: não trava.
 */
export function needsDiscountApproval(
  policy: DiscountPolicy,
  referenceCents: number,
  amountCents: number
): boolean {
  if (!policy.approvalEnabled) {
    return false
  }

  return (
    discountMilli(referenceCents, amountCents) >
    Math.max(0, toMilliPercent(policy.maxDiscountPercent))
  )
}

/** Valor da proposta e preço anunciado, em centavos. */
export type DiscountDeal = {
  amountCents: number
  referenceCents: number
}

/**
 * Um pedido aprovado ainda cobre a proposta: desde o pedido, o valor não baixou
 * e o preço anunciado não subiu. Trocar para um imóvel mais caro, mudar a
 * finalidade para a de preço maior ou reajustar o anúncio para cima pede
 * aprovação nova. Mesma regra de `private.proposal_discount_approved`.
 */
export function discountApprovalCovers(approved: DiscountDeal, current: DiscountDeal): boolean {
  return (
    safeCents(approved.amountCents) <= safeCents(current.amountCents) &&
    safeCents(approved.referenceCents) >= safeCents(current.referenceCents)
  )
}

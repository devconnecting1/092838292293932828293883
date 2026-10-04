import "server-only"

import type Stripe from "stripe"

import { parseReferralCouponId } from "@workspace/core/billing"

/**
 * Descontos de assinaturas e de agendas (Subscription Schedule) da Stripe.
 *
 * Verificado em modo teste (API 2026-08-26.dahlia):
 * - a agenda criada a partir da assinatura copia os descontos para a fase atual
 *   (com `coupon`); fases sem `discounts` explícitos ficam SEM desconto;
 * - atualizar os `discounts` das fases muda a assinatura na hora (fase atual);
 * - atualizar só a assinatura com agenda ativa muda a fase atual, mas não as
 *   futuras; depois disso a fase atual pode trazer só `discount` (di_...), sem
 *   `coupon`: o cupom sai do mapa de descontos da assinatura expandida.
 */

export type DiscountParam = { coupon?: string; discount?: string; promotion_code?: string }

type PhaseDiscount = Stripe.SubscriptionSchedule.Phase.Discount

function idOf(value: string | { id: string } | null | undefined): string | null {
  if (!value) {
    return null
  }

  return typeof value === "string" ? value : value.id
}

function couponOfDiscount(discount: Stripe.Discount): string | null {
  return idOf(discount.source?.coupon)
}

/** Cupom de um desconto da assinatura (precisa de `discounts` expandido). */
export function subscriptionDiscountCouponId(discount: string | Stripe.Discount): string | null {
  return typeof discount === "string" ? null : couponOfDiscount(discount)
}

/** id do desconto → id do cupom, a partir da assinatura com `discounts` expandido. */
export function couponIdsByDiscount(subscription: Stripe.Subscription): Map<string, string> {
  const map = new Map<string, string>()

  for (const discount of subscription.discounts) {
    const coupon = subscriptionDiscountCouponId(discount)

    if (typeof discount !== "string" && coupon) {
      map.set(discount.id, coupon)
    }
  }

  return map
}

export function phaseDiscountCouponId(
  discount: PhaseDiscount,
  couponsByDiscount: ReadonlyMap<string, string>
): string | null {
  const coupon = idOf(discount.coupon)

  if (coupon) {
    return coupon
  }

  if (discount.discount && typeof discount.discount !== "string") {
    return couponOfDiscount(discount.discount)
  }

  const discountId = idOf(discount.discount)
  return discountId ? (couponsByDiscount.get(discountId) ?? null) : null
}

export function isReferralPhaseDiscount(
  discount: PhaseDiscount,
  couponsByDiscount: ReadonlyMap<string, string>
): boolean {
  return parseReferralCouponId(phaseDiscountCouponId(discount, couponsByDiscount)) !== null
}

/**
 * Parâmetro que recria o desconto numa fase. Na fase atual reaproveita o
 * desconto existente (`discount`); em fases futuras prefere o cupom.
 */
export function phaseDiscountParam(
  discount: PhaseDiscount,
  couponsByDiscount: ReadonlyMap<string, string>,
  options: { preferCoupon: boolean }
): DiscountParam | null {
  const discountId = idOf(discount.discount)
  const coupon = phaseDiscountCouponId(discount, couponsByDiscount)
  const promotionCode = idOf(discount.promotion_code)

  if (options.preferCoupon && coupon) {
    return { coupon }
  }

  if (discountId) {
    return { discount: discountId }
  }

  if (coupon) {
    return { coupon }
  }

  return promotionCode ? { promotion_code: promotionCode } : null
}

/** Todos os descontos da fase, como parâmetros (cópia fiel). */
export function phaseDiscountParams(
  discounts: readonly PhaseDiscount[],
  couponsByDiscount: ReadonlyMap<string, string>,
  options: { preferCoupon: boolean }
): DiscountParam[] {
  return discounts.flatMap((discount) => {
    const param = phaseDiscountParam(discount, couponsByDiscount, options)
    return param ? [param] : []
  })
}

/**
 * Descontos da fase com o cupom de indicação trocado pelo alvo (null remove),
 * preservando os demais. `changed` = a fase precisa ser atualizada.
 */
export function phaseDiscountsWithReferralCoupon(
  discounts: readonly PhaseDiscount[],
  couponsByDiscount: ReadonlyMap<string, string>,
  targetCoupon: string | null,
  options: { preferCoupon: boolean }
): { params: DiscountParam[]; changed: boolean } {
  const referral = discounts.filter((discount) =>
    isReferralPhaseDiscount(discount, couponsByDiscount)
  )
  const others = discounts.filter(
    (discount) => !isReferralPhaseDiscount(discount, couponsByDiscount)
  )
  const alreadyApplied = targetCoupon
    ? referral.length === 1 &&
      phaseDiscountCouponId(referral[0] as PhaseDiscount, couponsByDiscount) === targetCoupon
    : referral.length === 0

  return {
    params: [
      ...phaseDiscountParams(others, couponsByDiscount, options),
      ...(targetCoupon ? [{ coupon: targetCoupon }] : []),
    ],
    changed: !alreadyApplied,
  }
}

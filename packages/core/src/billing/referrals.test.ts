import { describe, expect, it } from "vitest"

import {
  BILLING_INTERVALS,
  isBillingInterval,
  isPlanKey,
  PLAN_KEYS,
  PLANS,
  priceLookupKey,
} from "./plans"
import {
  computeReferralDiscount,
  isReferralConfirmationPending,
  normalizeReferralCode,
  parseReferralCouponId,
  planAnnualCents,
  planNetMonthlyCents,
  planReferralRecalculation,
  REFERRAL_CODE_ALPHABET,
  REFERRAL_CODE_LENGTH,
  REFERRAL_DISCOUNT_STEPS,
  REFERRAL_GRACE_DAYS,
  REFERRAL_MAX_PERCENT,
  REFERRAL_PAID_INVOICE_REASONS,
  REFERRAL_PERCENT_PER_ACTIVE,
  REFERRAL_VALUE_CAP_PERCENT,
  referralCouponId,
  referralGraceCompletionWindow,
  referralGraceEndsAt,
  referralLinkPath,
  referralReconcileSeed,
  resolveReferralStatus,
  type ReferralRecord,
  type ReferredAccount,
  type ReferrerAccount,
} from "./referrals"

const DAY_MS = 24 * 60 * 60 * 1000
const NOW = new Date("2026-09-15T12:00:00Z")

function daysAgo(days: number) {
  return new Date(NOW.getTime() - days * DAY_MS).toISOString()
}

/** Mensal equivalente do preço de catálogo (o que a indicada pagaria sem descontos). */
function catalogMonthly(planKey: unknown, interval: unknown): number | null {
  if (!isPlanKey(planKey) || !isBillingInterval(interval)) {
    return null
  }

  const price = PLANS[planKey].prices[interval]
  return interval === "month" ? price : Math.floor(price / 12)
}

function referred(overrides: Partial<ReferredAccount> = {}): ReferredAccount {
  const planKey = overrides.planKey ?? "imobiliaria"
  const interval = overrides.interval ?? "month"

  return {
    billingStatus: "active",
    firstPaidAt: daysAgo(REFERRAL_GRACE_DAYS + 5),
    discountPercent: 0,
    netMonthlyCents: catalogMonthly(planKey, interval),
    ...overrides,
    planKey,
    interval,
  }
}

function record(id: string, overrides: Partial<ReferralRecord> = {}): ReferralRecord {
  return {
    ...referred(overrides),
    id,
    countedAt: null,
    confirmedNotifiedAt: null,
    ...overrides,
  }
}

const ACTIVE_REFERRER: ReferrerAccount = {
  billingStatus: "active",
  planKey: "imobiliaria",
  interval: "month",
}

describe("constantes do programa", () => {
  it("segue as regras combinadas", () => {
    expect(REFERRAL_PERCENT_PER_ACTIVE).toBe(10)
    expect(REFERRAL_MAX_PERCENT).toBe(100)
    expect(REFERRAL_VALUE_CAP_PERCENT).toBe(50)
    expect(REFERRAL_GRACE_DAYS).toBe(30)
    expect(REFERRAL_CODE_LENGTH).toBe(8)
    expect(REFERRAL_DISCOUNT_STEPS).toEqual([10, 20, 30, 40, 50, 60, 70, 80, 90, 100])
    expect(REFERRAL_PAID_INVOICE_REASONS).toEqual(["subscription_create", "subscription_cycle"])
  })

  it("usa um alfabeto sem caracteres ambíguos", () => {
    expect(REFERRAL_CODE_ALPHABET).toHaveLength(31)
    expect(REFERRAL_CODE_ALPHABET).not.toMatch(/[01ILO]/)
    expect(new Set(REFERRAL_CODE_ALPHABET).size).toBe(REFERRAL_CODE_ALPHABET.length)
  })
})

describe("normalizeReferralCode", () => {
  it("aceita o formato válido, sem diferença de maiúsculas e espaços", () => {
    expect(normalizeReferralCode("ab23cd45")).toBe("AB23CD45")
    expect(normalizeReferralCode("  XYZ98765 ")).toBe("XYZ98765")
  })

  it("recusa tamanho errado, caracteres ambíguos e tipos inválidos", () => {
    expect(normalizeReferralCode("AB23CD4")).toBeNull()
    expect(normalizeReferralCode("AB23CD456")).toBeNull()
    expect(normalizeReferralCode("AB23CD40")).toBeNull()
    expect(normalizeReferralCode("AB23CDI5")).toBeNull()
    expect(normalizeReferralCode("AB23-D45")).toBeNull()
    expect(normalizeReferralCode(null)).toBeNull()
    expect(normalizeReferralCode(12345678)).toBeNull()
  })

  it("monta o caminho do link só com código válido", () => {
    expect(referralLinkPath("ab23cd45")).toBe("/i/AB23CD45")
    expect(referralLinkPath("../x")).toBeNull()
  })
})

describe("cupons de indicação", () => {
  it("mapeia degraus para ids e de volta", () => {
    expect(referralCouponId(10)).toBe("indicacao_10")
    expect(referralCouponId(100)).toBe("indicacao_100")
    expect(parseReferralCouponId("indicacao_30")).toBe(30)
  })

  it("não gera cupom para 0% nem fora dos degraus", () => {
    expect(referralCouponId(0)).toBeNull()
    expect(referralCouponId(15)).toBeNull()
    expect(referralCouponId(110)).toBeNull()
    expect(parseReferralCouponId("indicacao_15")).toBeNull()
    expect(parseReferralCouponId("promo_30")).toBeNull()
    expect(parseReferralCouponId(null)).toBeNull()
  })
})

describe("resolveReferralStatus", () => {
  it("aguarda pagamento sem 1ª fatura paga", () => {
    expect(resolveReferralStatus({ billingStatus: "trialing", firstPaidAt: null }, NOW)).toBe(
      "awaiting_payment"
    )
    expect(resolveReferralStatus({ billingStatus: "active", firstPaidAt: "x" }, NOW)).toBe(
      "awaiting_payment"
    )
  })

  it("fica em carência até completar 30 dias (limite inclusivo)", () => {
    expect(resolveReferralStatus({ billingStatus: "active", firstPaidAt: daysAgo(29) }, NOW)).toBe(
      "in_grace"
    )
    expect(resolveReferralStatus({ billingStatus: "active", firstPaidAt: daysAgo(30) }, NOW)).toBe(
      "active"
    )
  })

  it("é perdida quando já pagou e a assinatura deixou de estar ativa", () => {
    for (const status of ["canceled", "past_due", "unpaid", "trialing", null]) {
      expect(resolveReferralStatus({ billingStatus: status, firstPaidAt: daysAgo(40) }, NOW)).toBe(
        "lost"
      )
    }
  })

  it("estorno, disputa, membros em comum ou mesmo CNPJ tornam a indicação inelegível", () => {
    expect(
      resolveReferralStatus(
        { billingStatus: "active", firstPaidAt: daysAgo(40), ineligible: true },
        NOW
      )
    ).toBe("ineligible")
  })

  it("calcula o fim da carência", () => {
    expect(referralGraceEndsAt("2026-08-01T00:00:00Z")?.toISOString()).toBe(
      "2026-08-31T00:00:00.000Z"
    )
    expect(referralGraceEndsAt(null)).toBeNull()
  })
})

describe("planNetMonthlyCents", () => {
  it("desconta os descontos da linha e converte o anual para mensal (para baixo)", () => {
    expect(
      planNetMonthlyCents([{ amountCents: 32000, discountCents: 3200, interval: "month" }])
    ).toBe(28800)
    expect(planNetMonthlyCents([{ amountCents: 115000, discountCents: 0, interval: "year" }])).toBe(
      9583
    )
  })

  it("nunca fica negativo e ignora desconto negativo", () => {
    expect(
      planNetMonthlyCents([{ amountCents: 11500, discountCents: 12900, interval: "month" }])
    ).toBe(0)
    expect(
      planNetMonthlyCents([{ amountCents: 11500, discountCents: -500, interval: "month" }])
    ).toBe(11500)
  })

  it("devolve null sem linhas de plano", () => {
    expect(planNetMonthlyCents([])).toBeNull()
  })
})

describe("computeReferralDiscount", () => {
  it("soma 10% por indicação ativa de mesmo plano", () => {
    const result = computeReferralDiscount({
      referrer: ACTIVE_REFERRER,
      referrals: [referred(), referred(), referred()],
      now: NOW,
    })

    expect(result.percent).toBe(30)
    expect(result.appliedPercent).toBe(30)
    expect(result.pendingPercent).toBe(0)
    expect(result.applied).toBe(true)
    expect(result.estimated).toBe(false)
    expect(result.counts).toEqual({
      active: 3,
      in_grace: 0,
      awaiting_payment: 0,
      lost: 0,
      ineligible: 0,
    })
  })

  it("chega a 100% com 10 indicações e não passa disso", () => {
    const ten = computeReferralDiscount({
      referrer: ACTIVE_REFERRER,
      referrals: Array.from({ length: 10 }, () => referred()),
      now: NOW,
    })
    const twelve = computeReferralDiscount({
      referrer: ACTIVE_REFERRER,
      referrals: Array.from({ length: 12 }, () => referred()),
      now: NOW,
    })

    expect(ten.percent).toBe(100)
    expect(twelve.percent).toBe(100)
  })

  it("não conta indicações em carência, aguardando pagamento, perdidas ou inelegíveis", () => {
    const result = computeReferralDiscount({
      referrer: ACTIVE_REFERRER,
      referrals: [
        referred(),
        referred({ firstPaidAt: daysAgo(10) }),
        referred({ billingStatus: "trialing", firstPaidAt: null }),
        referred({ billingStatus: "canceled" }),
        referred({ ineligible: true }),
      ],
      now: NOW,
    })

    expect(result.percent).toBe(10)
    expect(result.statuses).toEqual([
      "active",
      "in_grace",
      "awaiting_payment",
      "lost",
      "ineligible",
    ])
    expect(result.counts).toEqual({
      active: 1,
      in_grace: 1,
      awaiting_payment: 1,
      lost: 1,
      ineligible: 1,
    })
  })

  it("estorno ou disputa zera a contribuição mesmo com assinatura ativa", () => {
    const result = computeReferralDiscount({
      referrer: ACTIVE_REFERRER,
      referrals: Array.from({ length: 5 }, () => referred({ ineligible: true })),
      now: NOW,
    })

    expect(result.percent).toBe(0)
    expect(result.counts.ineligible).toBe(5)
  })

  it("aplica a trava de valor: indicação barata rende no máximo 50% do que ela paga", () => {
    // Rede (R$ 1.930) indicando Corretor (R$ 115): 50% de 115 = 57,50 ≈ 2,98% do Rede.
    const referrer: ReferrerAccount = {
      billingStatus: "active",
      planKey: "rede",
      interval: "month",
    }
    const three = computeReferralDiscount({
      referrer,
      referrals: Array.from({ length: 3 }, () => referred({ planKey: "corretor" })),
      now: NOW,
    })
    const four = computeReferralDiscount({
      referrer,
      referrals: Array.from({ length: 4 }, () => referred({ planKey: "corretor" })),
      now: NOW,
    })

    // 3 × 2,98% = 8,94% → 0%; 4 × 2,98% = 11,92% → 10%.
    expect(three.percent).toBe(0)
    expect(four.percent).toBe(10)
  })

  it("a trava usa o valor líquido pago: código promocional de 90% derruba a contribuição", () => {
    // Imobiliária indicando Imobiliária: sem desconto rende 10%. Com 90% de
    // desconto a indicada paga R$ 32,00; 50% = R$ 16,00 = 5% do plano → 0%.
    const normal = computeReferralDiscount({
      referrer: ACTIVE_REFERRER,
      referrals: [referred()],
      now: NOW,
    })
    const promo = computeReferralDiscount({
      referrer: ACTIVE_REFERRER,
      referrals: [referred({ netMonthlyCents: 3200 })],
      now: NOW,
    })
    const promoTimesThree = computeReferralDiscount({
      referrer: ACTIVE_REFERRER,
      referrals: Array.from({ length: 3 }, () => referred({ netMonthlyCents: 3200 })),
      now: NOW,
    })

    expect(normal.percent).toBe(10)
    expect(promo.percent).toBe(0)
    // 3 × 5% = 15% → 10%.
    expect(promoTimesThree.percent).toBe(10)
  })

  it("sem valor líquido registrado a indicação ativa não rende desconto", () => {
    const result = computeReferralDiscount({
      referrer: ACTIVE_REFERRER,
      referrals: [referred({ netMonthlyCents: null }), referred({ netMonthlyCents: undefined })],
      now: NOW,
    })

    expect(result.counts.active).toBe(2)
    expect(result.percent).toBe(0)
  })

  it("arredonda para baixo a soma de indicações normais e travadas", () => {
    const referrer: ReferrerAccount = {
      billingStatus: "active",
      planKey: "rede",
      interval: "month",
    }
    const result = computeReferralDiscount({
      referrer,
      referrals: [
        referred({ planKey: "rede" }),
        referred({ planKey: "rede" }),
        referred({ planKey: "corretor" }),
        referred({ planKey: "corretor" }),
        referred({ planKey: "corretor" }),
      ],
      now: NOW,
    })

    // 10 + 10 + 3 × 2,99 = 28,96% → 20%.
    expect(result.percent).toBe(20)
  })

  it("não trava quando a indicada paga um plano igual ou maior", () => {
    const referrer: ReferrerAccount = {
      billingStatus: "active",
      planKey: "corretor",
      interval: "month",
    }
    const result = computeReferralDiscount({
      referrer,
      referrals: [referred({ planKey: "rede" })],
      now: NOW,
    })

    expect(result.percent).toBe(10)
  })

  it("limita pelo catálogo menos o desconto por indicações da indicada (fatura antiga)", () => {
    // Fatura antiga registrou R$ 115, mas agora a indicada tem 80% de desconto:
    // vale o menor (R$ 23,00) → 50% = 11,50 = 3,59% do Imobiliária → 0%.
    const discounted = computeReferralDiscount({
      referrer: ACTIVE_REFERRER,
      referrals: [referred({ planKey: "corretor", discountPercent: 80 })],
      now: NOW,
    })
    const free = computeReferralDiscount({
      referrer: ACTIVE_REFERRER,
      referrals: Array.from({ length: 10 }, () => referred({ discountPercent: 100 })),
      now: NOW,
    })

    expect(discounted.percent).toBe(0)
    expect(free.percent).toBe(0)
  })

  it("compara ciclos pelo valor mensal equivalente (anual ÷ 12)", () => {
    const referrerMonthly = computeReferralDiscount({
      referrer: ACTIVE_REFERRER,
      referrals: [referred({ planKey: "corretor", interval: "year" })],
      now: NOW,
    })
    const referrerYearly = computeReferralDiscount({
      referrer: { billingStatus: "active", planKey: "rede", interval: "year" },
      referrals: Array.from({ length: 4 }, () =>
        referred({ planKey: "corretor", interval: "year" })
      ),
      now: NOW,
    })

    expect(referrerMonthly.percent).toBe(10)
    expect(referrerYearly.percent).toBe(10)
    expect(planAnnualCents("corretor", "month")).toBe(PLANS.corretor.prices.month * 12)
    expect(planAnnualCents("corretor", "year")).toBe(PLANS.corretor.prices.year)
  })

  it("usa os preços do catálogo da Stripe quando informados", () => {
    const prices = { [priceLookupKey("imobiliaria", "month")]: 1_000_000 }
    // Indicador pagando R$ 10.000: Corretor (R$ 115) rende 0,58% → 0% mesmo com 10.
    const result = computeReferralDiscount({
      referrer: ACTIVE_REFERRER,
      referrals: Array.from({ length: 10 }, () => referred({ planKey: "corretor" })),
      prices,
      now: NOW,
    })

    expect(result.percent).toBe(0)
    expect(planAnnualCents("imobiliaria", "month", { bad: 1 })).toBe(
      PLANS.imobiliaria.prices.month * 12
    )
  })

  it("mostra o acumulado como a aplicar quando o indicador não está ativo", () => {
    const result = computeReferralDiscount({
      referrer: { billingStatus: "past_due", planKey: "imobiliaria", interval: "month" },
      referrals: [referred(), referred()],
      now: NOW,
    })

    expect(result.percent).toBe(20)
    expect(result.applied).toBe(false)
    expect(result.appliedPercent).toBe(0)
    expect(result.pendingPercent).toBe(20)
  })

  it("estima sem trava de valor quando o indicador ainda não tem plano pago", () => {
    const result = computeReferralDiscount({
      referrer: { billingStatus: "trialing", planKey: "trial", interval: null },
      referrals: [referred({ planKey: "corretor" }), referred({ planKey: "corretor" })],
      now: NOW,
    })

    expect(result.estimated).toBe(true)
    expect(result.percent).toBe(20)
    expect(result.pendingPercent).toBe(20)
  })

  it("devolve zero sem indicações", () => {
    const result = computeReferralDiscount({ referrer: ACTIVE_REFERRER, referrals: [], now: NOW })

    expect(result.percent).toBe(0)
    expect(result.statuses).toEqual([])
  })
})

describe("planReferralRecalculation (transições persistidas)", () => {
  it("marca quem passou a contar e desmarca quem deixou de contar (aviso de perda)", () => {
    const plan = planReferralRecalculation({
      referrer: ACTIVE_REFERRER,
      referrals: [
        record("nova-ativa"),
        record("continua-ativa", { countedAt: daysAgo(10) }),
        record("cancelou", { billingStatus: "canceled", countedAt: daysAgo(10) }),
        record("estornou", { ineligible: true, countedAt: daysAgo(10) }),
        record("em-carencia", { firstPaidAt: daysAgo(5) }),
      ],
      now: NOW,
    })

    expect(plan.toCount).toEqual(["nova-ativa"])
    expect(plan.toUncount).toEqual(["cancelou", "estornou"])
    expect(plan.targetPercent).toBe(20)
  })

  it("é idempotente: aplicar as transições e recalcular não gera novas", () => {
    const now = NOW
    const first = planReferralRecalculation({
      referrer: ACTIVE_REFERRER,
      referrals: [record("a"), record("b", { billingStatus: "past_due", countedAt: daysAgo(3) })],
      now,
    })
    const second = planReferralRecalculation({
      referrer: ACTIVE_REFERRER,
      referrals: [
        record("a", { countedAt: now.toISOString() }),
        record("b", { billingStatus: "past_due", countedAt: null }),
      ],
      now,
    })

    expect(first.toCount).toEqual(["a"])
    expect(first.toUncount).toEqual(["b"])
    expect(second.toCount).toEqual([])
    expect(second.toUncount).toEqual([])
    expect(second.targetPercent).toBe(first.targetPercent)
  })

  it("confirma só carências completadas nos últimos 3 dias e ainda não avisadas", () => {
    const plan = planReferralRecalculation({
      referrer: ACTIVE_REFERRER,
      referrals: [
        record("completou-ontem", { firstPaidAt: daysAgo(REFERRAL_GRACE_DAYS + 1) }),
        record("ja-avisada", {
          firstPaidAt: daysAgo(REFERRAL_GRACE_DAYS + 1),
          confirmedNotifiedAt: daysAgo(0.5),
        }),
        record("completou-ha-10-dias", { firstPaidAt: daysAgo(REFERRAL_GRACE_DAYS + 10) }),
        record("perdida", {
          firstPaidAt: daysAgo(REFERRAL_GRACE_DAYS + 1),
          billingStatus: "canceled",
        }),
      ],
      now: NOW,
    })

    expect(plan.pendingConfirmations).toEqual(["completou-ontem"])
  })

  it("não grava a estimativa de quem ainda não tem plano pago", () => {
    const plan = planReferralRecalculation({
      referrer: { billingStatus: "trialing", planKey: "trial", interval: null },
      referrals: [record("a"), record("b")],
      now: NOW,
    })

    expect(plan.discount.percent).toBe(20)
    expect(plan.discount.estimated).toBe(true)
    expect(plan.targetPercent).toBe(0)
  })

  it("confirmação pendente respeita os limites da janela", () => {
    const pending = (days: number, notified: string | null = null) =>
      isReferralConfirmationPending(
        { firstPaidAt: daysAgo(REFERRAL_GRACE_DAYS + days), confirmedNotifiedAt: notified },
        NOW
      )

    expect(pending(0)).toBe(true)
    expect(pending(2.9)).toBe(true)
    expect(pending(3)).toBe(false)
    expect(pending(-0.1)).toBe(false)
    expect(pending(1, daysAgo(1))).toBe(false)
    expect(
      isReferralConfirmationPending({ firstPaidAt: null, confirmedNotifiedAt: null }, NOW)
    ).toBe(false)
  })
})

describe("janelas do cron e reconciliação", () => {
  it("revisa carências completadas nos últimos dias", () => {
    const { paidAfter, paidUntil } = referralGraceCompletionWindow(NOW)

    expect(paidUntil.toISOString()).toBe(daysAgo(30))
    expect(paidAfter.toISOString()).toBe(daysAgo(33))
  })

  it("muda a ordem da reconciliação a cada dia (UTC)", () => {
    expect(referralReconcileSeed(NOW)).toBe("2026-09-15")
    expect(referralReconcileSeed(new Date("2026-09-15T23:59:59Z"))).toBe("2026-09-15")
    expect(referralReconcileSeed(new Date("2026-09-16T00:00:00Z"))).toBe("2026-09-16")
  })
})

// A trava de valor é o que torna a autoindicação (segundo e-mail, sem vínculo
// nenhum com a indicadora — o banco não bloqueia esse caso) um mau negócio: o
// desconto que o indicador ganha em reais nunca passa de
// REFERRAL_VALUE_CAP_PERCENT% do que as indicadas pagam de fato. Estes testes
// travam essa propriedade em toda a grade de planos e ciclos.
describe("antifraude: o desconto vale no máximo metade do que a indicada paga", () => {
  /** Valor anual, em centavos, do desconto que o indicador recebe. */
  function discountValueAnnualCents(
    referrer: ReferrerAccount,
    referrals: readonly ReferredAccount[]
  ): number {
    const { percent } = computeReferralDiscount({ referrer, referrals, now: NOW })

    if (!isPlanKey(referrer.planKey) || !isBillingInterval(referrer.interval)) {
      throw new Error("indicador sem plano pago")
    }

    return (planAnnualCents(referrer.planKey, referrer.interval) * percent) / 100
  }

  function paidAnnualCents(referrals: readonly ReferredAccount[]): number {
    return referrals.reduce((total, item) => total + (item.netMonthlyCents ?? 0) * 12, 0)
  }

  it("vale para toda combinação de plano e ciclo do indicador e da indicada", () => {
    for (const referrerPlan of PLAN_KEYS) {
      for (const referrerInterval of BILLING_INTERVALS) {
        for (const referredPlan of PLAN_KEYS) {
          for (const referredInterval of BILLING_INTERVALS) {
            const referrer: ReferrerAccount = {
              billingStatus: "active",
              planKey: referrerPlan,
              interval: referrerInterval,
            }
            const referrals = [referred({ planKey: referredPlan, interval: referredInterval })]
            const cap = (paidAnnualCents(referrals) * REFERRAL_VALUE_CAP_PERCENT) / 100

            expect(discountValueAnnualCents(referrer, referrals)).toBeLessThanOrEqual(cap)
          }
        }
      }
    }
  })

  it("continua valendo com várias indicadas, inclusive até o teto de 100%", () => {
    for (const count of [1, 3, 10, 25]) {
      const referrals = Array.from({ length: count }, () => referred({ planKey: "corretor" }))
      const cap = (paidAnnualCents(referrals) * REFERRAL_VALUE_CAP_PERCENT) / 100

      expect(discountValueAnnualCents(ACTIVE_REFERRER, referrals)).toBeLessThanOrEqual(cap)
    }
  })

  it("vale também quando a indicada já paga com desconto de indicações", () => {
    const monthly = catalogMonthly("imobiliaria", "month") ?? 0
    const referrals = [
      // 60% de desconto na mensalidade dela: a fatura líquida cai junto.
      referred({ discountPercent: 60, netMonthlyCents: Math.floor(monthly * 0.4) }),
    ]
    const cap = (paidAnnualCents(referrals) * REFERRAL_VALUE_CAP_PERCENT) / 100

    expect(discountValueAnnualCents(ACTIVE_REFERRER, referrals)).toBeLessThanOrEqual(cap)
  })

  it("indicada inelegível não rende nada, por mais que pague", () => {
    const referrals = [referred({ planKey: "rede", interval: "year", ineligible: true })]

    expect(discountValueAnnualCents(ACTIVE_REFERRER, referrals)).toBe(0)
  })
})

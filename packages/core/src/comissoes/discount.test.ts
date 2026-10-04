import { describe, expect, it } from "vitest"

import {
  discountApprovalCovers,
  discountMilli,
  discountPercent,
  needsDiscountApproval,
} from "./discount"

const ON = { approvalEnabled: true, maxDiscountPercent: 10 }

describe("discountPercent", () => {
  it("mede o quanto a proposta está abaixo do preço anunciado", () => {
    expect(discountPercent(50_000_000, 45_000_000)).toBe(10)
    expect(discountPercent(50_000_000, 44_999_999)).toBe(10.001)
    expect(discountMilli(50_000_000, 45_000_000)).toBe(10_000)
  })

  it("é zero sem preço de tabela ou quando a proposta cobre o anunciado", () => {
    expect(discountPercent(0, 45_000_000)).toBe(0)
    expect(discountPercent(50_000_000, 50_000_000)).toBe(0)
    expect(discountPercent(50_000_000, 60_000_000)).toBe(0)
  })
})

describe("needsDiscountApproval", () => {
  it("só trava acima do limite configurado", () => {
    expect(needsDiscountApproval(ON, 50_000_000, 45_000_000)).toBe(false)
    expect(needsDiscountApproval(ON, 50_000_000, 44_999_999)).toBe(true)
    expect(needsDiscountApproval(ON, 50_000_000, 40_000_000)).toBe(true)
  })

  it("não trava com a aprovação desligada nem sem preço de tabela", () => {
    expect(needsDiscountApproval({ ...ON, approvalEnabled: false }, 50_000_000, 10_000_000)).toBe(
      false
    )
    expect(needsDiscountApproval(ON, 0, 10_000_000)).toBe(false)
  })

  it("com limite zero, qualquer desconto precisa de aprovação", () => {
    const strict = { approvalEnabled: true, maxDiscountPercent: 0 }

    expect(needsDiscountApproval(strict, 50_000_000, 50_000_000)).toBe(false)
    expect(needsDiscountApproval(strict, 50_000_000, 49_999_999)).toBe(true)
  })
})

describe("discountApprovalCovers", () => {
  // Aprovado: R$ 320.000 sobre R$ 400.000 anunciados.
  const APPROVED = { amountCents: 32_000_000, referenceCents: 40_000_000 }

  it("cobre o mesmo valor ou um maior, com o mesmo anunciado", () => {
    expect(discountApprovalCovers(APPROVED, APPROVED)).toBe(true)
    expect(discountApprovalCovers(APPROVED, { ...APPROVED, amountCents: 33_000_000 })).toBe(true)
  })

  it("não cobre valor menor que o aprovado", () => {
    expect(discountApprovalCovers(APPROVED, { ...APPROVED, amountCents: 31_999_999 })).toBe(false)
  })

  it("não cobre anunciado maior (imóvel mais caro ou anúncio reajustado)", () => {
    expect(discountApprovalCovers(APPROVED, { ...APPROVED, referenceCents: 50_000_000 })).toBe(
      false
    )
  })

  it("cobre anunciado menor com o mesmo valor", () => {
    expect(discountApprovalCovers(APPROVED, { ...APPROVED, referenceCents: 38_000_000 })).toBe(true)
  })
})

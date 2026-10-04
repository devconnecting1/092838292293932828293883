import { describe, expect, it } from "vitest"

import {
  COMMISSION_ROLES,
  commissionTotalCents,
  type CommissionRule,
  type CommissionSplit,
} from "./rules"
import { effectiveSplitMilli, splitCommission, totalOfShares } from "./split"

const EQUAL_THIRDS: CommissionSplit = {
  capturer: 33.333,
  seller: 33.333,
  manager: 33.334,
  agency: 0,
  partner: 0,
}

const HOUSE_SPLIT: CommissionSplit = {
  capturer: 20,
  seller: 30,
  manager: 10,
  agency: 40,
  partner: 0,
}

const THREE_PEOPLE = {
  capturer: "u-captador",
  seller: "u-corretor",
  manager: "u-gerente",
  partner: null,
}

function amountOf(shares: ReturnType<typeof splitCommission>, role: string) {
  return shares.find((share) => share.role === role)?.amountCents ?? 0
}

describe("splitCommission", () => {
  it("fecha o centavo exato com três pessoas em R$ 10.000,01", () => {
    const total = 1_000_001
    const shares = splitCommission(total, EQUAL_THIRDS, THREE_PEOPLE)

    expect(amountOf(shares, "capturer")).toBe(333_330)
    expect(amountOf(shares, "seller")).toBe(333_330)
    expect(amountOf(shares, "manager")).toBe(333_340)
    // A sobra de 1 centavo fica com a imobiliária (regra documentada no módulo).
    expect(amountOf(shares, "agency")).toBe(1)
    expect(totalOfShares(shares)).toBe(total)
  })

  it("nunca perde nem inventa centavo, em qualquer valor", () => {
    const splits: CommissionSplit[] = [
      EQUAL_THIRDS,
      HOUSE_SPLIT,
      { capturer: 50, seller: 50, manager: 0, agency: 0, partner: 0 },
      { capturer: 16.667, seller: 16.667, manager: 16.666, agency: 25, partner: 25 },
      { capturer: 0, seller: 100, manager: 0, agency: 0, partner: 0 },
      { capturer: 0, seller: 0, manager: 0, agency: 100, partner: 0 },
    ]
    const participants = { ...THREE_PEOPLE, partner: "Imobiliária Parceira" }

    for (const split of splits) {
      for (let total = 0; total <= 1500; total += 1) {
        const shares = splitCommission(total, split, participants)

        expect(totalOfShares(shares)).toBe(total)
        expect(shares.every((share) => share.amountCents >= 0)).toBe(true)
      }
    }
  })

  it("tira a diferença da maior parte quando o arredondamento passa do total", () => {
    // 50/50 de 7 centavos arredonda para 4 + 4 = 8: um centavo a mais que o total.
    const shares = splitCommission(
      7,
      { capturer: 50, seller: 50, manager: 0, agency: 0, partner: 0 },
      THREE_PEOPLE
    )

    expect(amountOf(shares, "capturer")).toBe(4)
    expect(amountOf(shares, "seller")).toBe(3)
    expect(amountOf(shares, "agency")).toBe(0)
    expect(totalOfShares(shares)).toBe(7)
  })

  it("manda para a imobiliária o percentual de papel sem pessoa", () => {
    const shares = splitCommission(100_000, HOUSE_SPLIT, {
      capturer: null,
      seller: "u-corretor",
      manager: null,
      partner: null,
    })

    expect(amountOf(shares, "seller")).toBe(30_000)
    // 40% da imobiliária + 20% da captação sem captador + 10% sem gerente.
    expect(amountOf(shares, "agency")).toBe(70_000)
    expect(shares.some((share) => share.role === "capturer")).toBe(false)
    expect(shares.some((share) => share.role === "manager")).toBe(false)
    expect(totalOfShares(shares)).toBe(100_000)
  })

  it("registra o parceiro externo pelo nome, sem usuário", () => {
    const shares = splitCommission(
      100_000,
      { capturer: 20, seller: 30, manager: 0, agency: 30, partner: 20 },
      { ...THREE_PEOPLE, manager: null, partner: "Imobiliária Parceira" }
    )
    const partner = shares.find((share) => share.role === "partner")

    expect(partner?.amountCents).toBe(20_000)
    expect(partner?.userId).toBeNull()
    expect(partner?.partnerName).toBe("Imobiliária Parceira")
    expect(totalOfShares(shares)).toBe(100_000)
  })

  it("devolve as partes na ordem dos papéis e sempre com a imobiliária", () => {
    const shares = splitCommission(1_000, HOUSE_SPLIT, THREE_PEOPLE)
    const order = shares.map((share) => share.role)

    expect(order).toEqual(COMMISSION_ROLES.filter((role) => role !== "partner"))
  })

  it("com total zero devolve tudo zerado e ainda fecha", () => {
    const shares = splitCommission(0, HOUSE_SPLIT, THREE_PEOPLE)

    expect(totalOfShares(shares)).toBe(0)
    expect(shares.every((share) => share.amountCents === 0)).toBe(true)
  })
})

describe("effectiveSplitMilli", () => {
  it("soma sempre 100% quando a regra fecha, mesmo sem ninguém nos papéis", () => {
    const effective = effectiveSplitMilli(HOUSE_SPLIT, {
      capturer: null,
      seller: null,
      manager: null,
      partner: null,
    })

    expect(effective.agency).toBe(100_000)
    expect(COMMISSION_ROLES.reduce((total, role) => total + effective[role], 0)).toBe(100_000)
  })
})

describe("regra congelada", () => {
  it("a comissão do negócio antigo não muda quando a tabela muda hoje", () => {
    const atClosing: CommissionRule = {
      purpose: "sale",
      basis: "percent",
      percent: 6,
      fixedCents: 0,
      split: HOUSE_SPLIT,
    }
    const today: CommissionRule = {
      purpose: "sale",
      basis: "percent",
      percent: 4,
      fixedCents: 0,
      split: { capturer: 10, seller: 10, manager: 10, agency: 70, partner: 0 },
    }
    const dealCents = 35_000_000

    const frozen = splitCommission(
      commissionTotalCents(atClosing, dealCents),
      atClosing.split,
      THREE_PEOPLE
    )
    const recalculated = splitCommission(
      commissionTotalCents(today, dealCents),
      today.split,
      THREE_PEOPLE
    )

    expect(totalOfShares(frozen)).toBe(2_100_000)
    expect(totalOfShares(recalculated)).toBe(1_400_000)
    expect(amountOf(frozen, "seller")).toBe(630_000)
    expect(amountOf(recalculated, "seller")).toBe(140_000)
  })
})

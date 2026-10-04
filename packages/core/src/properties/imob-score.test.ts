import { describe, expect, it } from "vitest"
import { computeImobScore, type ImobScoreInput } from "./imob-score"

const NOW = new Date("2026-09-15T12:00:00Z")

function findItem(result: ReturnType<typeof computeImobScore>, key: string) {
  const item = result.items.find((candidate) => candidate.key === key)
  if (!item) throw new Error(`item "${key}" não encontrado`)
  return item
}

describe("computeImobScore", () => {
  it("imóvel vazio tem pontuação baixa (zero)", () => {
    const input: ImobScoreInput = {
      purpose: "sale",
      type: "apartment",
      photosCount: 0,
    }

    const result = computeImobScore(input, NOW)

    expect(result.score).toBe(0)
    expect(result.items.every((item) => !item.done)).toBe(true)
  })

  it("imóvel completo atinge 100 pontos", () => {
    const input: ImobScoreInput = {
      purpose: "sale",
      type: "apartment",
      photosCount: 15,
      description: "A".repeat(300),
      prices: { salePrice: 500_000, condoFee: 450, iptuYearly: 1200 },
      livingArea: 75,
      bedrooms: 3,
      bathrooms: 2,
      address: { postalCode: "01001-000", latitude: -23.55, longitude: -46.63 },
      videoUrl: "https://youtube.com/watch?v=abc123",
      saleAuthorizationExpiresAt: new Date("2026-12-31T00:00:00Z"),
    }

    const result = computeImobScore(input, NOW)

    expect(result.score).toBe(100)
    expect(result.items.every((item) => item.done)).toBe(true)
  })

  describe("fotos (fronteiras)", () => {
    const base: ImobScoreInput = {
      purpose: "sale",
      type: "apartment",
      photosCount: 0,
    }

    it("4 fotos pontua proporcionalmente (10 pts) e não conclui o item", () => {
      const result = computeImobScore({ ...base, photosCount: 4 }, NOW)
      const item = findItem(result, "photos")
      expect(item.points).toBe(10)
      expect(item.done).toBe(false)
    })

    it("5 fotos pontua 20", () => {
      const result = computeImobScore({ ...base, photosCount: 5 }, NOW)
      const item = findItem(result, "photos")
      expect(item.points).toBe(20)
      expect(item.done).toBe(false)
    })

    it("15 fotos pontua o máximo (30) e conclui o item", () => {
      const result = computeImobScore({ ...base, photosCount: 15 }, NOW)
      const item = findItem(result, "photos")
      expect(item.points).toBe(30)
      expect(item.done).toBe(true)
    })

    it("hint do item de fotos menciona o mínimo de 5 exigido pelos portais", () => {
      const result = computeImobScore(base, NOW)
      expect(findItem(result, "photos").hint).toContain("5")
    })
  })

  describe("descrição (fronteiras)", () => {
    const base: ImobScoreInput = {
      purpose: "sale",
      type: "apartment",
      photosCount: 0,
    }

    it("49 caracteres não pontua", () => {
      const result = computeImobScore({ ...base, description: "A".repeat(49) }, NOW)
      expect(findItem(result, "description").points).toBe(0)
    })

    it("50 caracteres pontua 7", () => {
      const result = computeImobScore({ ...base, description: "A".repeat(50) }, NOW)
      expect(findItem(result, "description").points).toBe(7)
    })

    it("300 caracteres pontua o máximo (15)", () => {
      const result = computeImobScore({ ...base, description: "A".repeat(300) }, NOW)
      const item = findItem(result, "description")
      expect(item.points).toBe(15)
      expect(item.done).toBe(true)
    })

    it("não conta espaços extras na contagem de caracteres", () => {
      const paddedTo50 = `${"A".repeat(50)}     `
      const result = computeImobScore({ ...base, description: paddedTo50 }, NOW)
      expect(findItem(result, "description").points).toBe(7)
    })
  })

  describe("preços", () => {
    it("casa (sem condomínio aplicável) recebe o bônus de condomínio automaticamente", () => {
      const result = computeImobScore(
        {
          purpose: "sale",
          type: "house",
          photosCount: 0,
          prices: { salePrice: 300_000 },
        },
        NOW
      )
      // 9 (preço obrigatório) + 3 (condomínio considerado atendido) + 0 (sem IPTU)
      expect(findItem(result, "prices").points).toBe(12)
    })

    it("apartamento sem condomínio informado não recebe o bônus de condomínio", () => {
      const result = computeImobScore(
        {
          purpose: "sale",
          type: "apartment",
          photosCount: 0,
          prices: { salePrice: 300_000 },
        },
        NOW
      )
      expect(findItem(result, "prices").points).toBe(9)
    })

    it("sale_rent exige os dois preços para o bônus de preço obrigatório", () => {
      const onlySale = computeImobScore(
        {
          purpose: "sale_rent",
          type: "apartment",
          photosCount: 0,
          prices: { salePrice: 300_000 },
        },
        NOW
      )
      expect(findItem(onlySale, "prices").points).toBe(0)

      const both = computeImobScore(
        {
          purpose: "sale_rent",
          type: "apartment",
          photosCount: 0,
          prices: { salePrice: 300_000, rentPrice: 2_000 },
        },
        NOW
      )
      expect(findItem(both, "prices").points).toBe(9)
    })
  })

  describe("áreas e cômodos", () => {
    it("terreno considera apenas a área (quartos/banheiros concedidos automaticamente)", () => {
      const result = computeImobScore(
        { purpose: "sale", type: "land", photosCount: 0, lotArea: 500 },
        NOW
      )
      expect(findItem(result, "areas").points).toBe(10)
    })

    it("apartamento sem quartos/banheiros perde os 4 pontos de cômodos", () => {
      const result = computeImobScore(
        { purpose: "sale", type: "apartment", photosCount: 0, livingArea: 75 },
        NOW
      )
      expect(findItem(result, "areas").points).toBe(6)
    })
  })

  describe("autorização de venda", () => {
    it("autorização vencida não pontua", () => {
      const result = computeImobScore(
        {
          purpose: "sale",
          type: "apartment",
          photosCount: 0,
          saleAuthorizationExpiresAt: new Date("2026-01-01T00:00:00Z"),
        },
        NOW
      )
      const item = findItem(result, "authorization")
      expect(item.points).toBe(0)
      expect(item.done).toBe(false)
    })

    it("autorização vigente na data de referência pontua o máximo", () => {
      const result = computeImobScore(
        {
          purpose: "sale",
          type: "apartment",
          photosCount: 0,
          saleAuthorizationExpiresAt: new Date("2026-12-31T00:00:00Z"),
        },
        NOW
      )
      expect(findItem(result, "authorization").points).toBe(10)
    })
  })
})

import { describe, expect, it } from "vitest"
import { scoreMatch, type ClientInterest, type PropertyForMatch } from "./client-property-match"

describe("scoreMatch", () => {
  const property: PropertyForMatch = {
    purpose: "sale",
    type: "apartment",
    salePrice: 500_000,
    bedrooms: 3,
    parkingSpaces: 2,
    neighborhood: "Centro",
    city: "São Paulo",
  }

  it("retorna 0 quando a finalidade não corresponde", () => {
    const interest: ClientInterest = { purpose: "rent" }
    const result = scoreMatch(interest, property)
    expect(result.score).toBe(0)
    expect(result.reasons[0]).toMatch(/finalidade/i)
  })

  it("aceita imóveis com finalidade sale_rent para qualquer interesse", () => {
    const interest: ClientInterest = { purpose: "rent" }
    const result = scoreMatch(interest, { ...property, purpose: "sale_rent" })
    expect(result.score).toBeGreaterThan(0)
  })

  it("interesse em venda ou locação aceita imóvel só de venda ou só de locação", () => {
    const interest: ClientInterest = { purpose: "sale_rent", maxPrice: 4_000 }

    const forSale = scoreMatch(interest, property)
    expect(forSale.score).toBeGreaterThan(0)
    expect(forSale.reasons).toContain("Preço fora da faixa de interesse do cliente.")

    const forRent = scoreMatch(interest, {
      ...property,
      purpose: "rent",
      salePrice: undefined,
      rentPrice: 3_500,
    })
    expect(forRent.score).toBeGreaterThan(0)
    expect(forRent.reasons).toContain("Preço dentro da faixa de interesse do cliente.")
  })

  it("compara bairro e cidade sem diferenciar acentos e maiúsculas", () => {
    const withNeighborhood = scoreMatch(
      { purpose: "sale", neighborhoods: ["CAMBUI"] },
      { ...property, neighborhood: "Cambuí" }
    )
    expect(withNeighborhood.reasons).toContain("Bairro corresponde ao interesse do cliente.")

    const withCity = scoreMatch({ purpose: "sale", city: "sao paulo" }, property)
    expect(withCity.reasons).toContain("Cidade corresponde ao interesse do cliente.")
  })

  it("pontua o máximo quando todos os critérios batem", () => {
    const interest: ClientInterest = {
      purpose: "sale",
      types: ["apartment"],
      minPrice: 400_000,
      maxPrice: 600_000,
      minBedrooms: 2,
      minParkingSpaces: 1,
      neighborhoods: ["Centro"],
    }

    const result = scoreMatch(interest, property)

    expect(result.score).toBe(100)
  })

  it("reduz a pontuação quando o preço está fora da faixa", () => {
    const interest: ClientInterest = { purpose: "sale", minPrice: 600_000 }
    const result = scoreMatch(interest, property)
    expect(result.reasons).toContain("Preço fora da faixa de interesse do cliente.")
  })

  it("reduz a pontuação quando não atinge o mínimo de quartos ou vagas", () => {
    const interest: ClientInterest = {
      purpose: "sale",
      minBedrooms: 4,
      minParkingSpaces: 3,
    }
    const result = scoreMatch(interest, property)
    expect(result.reasons).toContain("Não atende ao número mínimo de quartos.")
    expect(result.reasons).toContain("Não atende ao número mínimo de vagas de garagem.")
  })

  it("usa a cidade como critério auxiliar quando não há bairros de interesse", () => {
    const interest: ClientInterest = { purpose: "sale", city: "São Paulo" }
    const result = scoreMatch(interest, property)
    expect(result.reasons).toContain("Cidade corresponde ao interesse do cliente.")
  })

  it("não restringir tipo ainda concede pontuação parcial pelo critério de tipo", () => {
    const interest: ClientInterest = { purpose: "sale" }
    const result = scoreMatch(interest, property)
    expect(result.reasons).toContain("Cliente não restringiu o tipo de imóvel.")
  })
})

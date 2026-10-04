import { describe, expect, it } from "vitest"

import { parseCaixaDescription } from "./description"

// As descrições abaixo são registros reais do arquivo de 15/09/2026.
describe("parseCaixaDescription", () => {
  it("lê um apartamento completo", () => {
    const facts = parseCaixaDescription(
      "Apartamento, 74.12 de área total, 56.82 de área privativa, 0.00 de área do terreno, 2 qto(s), varanda, a.serv, WC, 1 sala(s), cozinha, 1 vaga(s) de garagem."
    )

    expect(facts).toEqual({
      type: "apartment",
      rawType: "Apartamento",
      totalArea: 74.12,
      privateArea: 56.82,
      landArea: null,
      bedrooms: 2,
      parkingSpaces: 1,
      livingRooms: 1,
    })
  })

  it("trata 0.00 como área não informada, não como zero", () => {
    const facts = parseCaixaDescription(
      "Terreno, 0.00 de área total, 0.00 de área privativa, 1404.26 de área do terreno."
    )

    expect(facts.type).toBe("land")
    expect(facts.totalArea).toBeNull()
    expect(facts.privateArea).toBeNull()
    expect(facts.landArea).toBe(1404.26)
    expect(facts.bedrooms).toBeNull()
  })

  it("mapeia os 12 rótulos observados no arquivo", () => {
    const cases: [string, string][] = [
      ["Apartamento, 1.00 de área total", "apartment"],
      ["Casa, 1.00 de área total", "house"],
      ["Sobrado, 1.00 de área total", "house"],
      ["Terreno, 1.00 de área total", "land"],
      ["Gleba, 1.00 de área total", "land"],
      ["Imóvel rural, 1.00 de área total", "farm"],
      ["Prédio, 1.00 de área total", "building"],
      ["Sala, 1.00 de área total", "commercial_room"],
      ["Loja, 1.00 de área total", "store"],
      ["Galpão, 1.00 de área total", "warehouse"],
      ["Comercial, 1.00 de área total", "other"],
      ["Outros, 1.00 de área total", "other"],
    ]

    for (const [description, expected] of cases) {
      expect(parseCaixaDescription(description).type).toBe(expected)
    }
  })

  it("aceita rótulo sem acento e com caixa diferente", () => {
    expect(parseCaixaDescription("imovel rural, 1.00 de área total").type).toBe("farm")
    expect(parseCaixaDescription("GALPAO, 1.00 de área total").type).toBe("warehouse")
  })

  it("cai em 'other' quando a Caixa criar um rótulo novo", () => {
    const facts = parseCaixaDescription("Chalé flutuante, 30.00 de área total")

    expect(facts.type).toBe("other")
    expect(facts.rawType).toBe("Chalé flutuante")
    expect(facts.totalArea).toBe(30)
  })

  it("lê área de terreno muito grande (imóvel rural)", () => {
    expect(
      parseCaixaDescription(
        "Imóvel rural, 0.00 de área total, 0.00 de área privativa, 3780374.00 de área do terreno."
      ).landArea
    ).toBe(3_780_374)
  })

  it("devolve tudo nulo quando não há descrição", () => {
    expect(parseCaixaDescription("")).toEqual({
      type: "other",
      rawType: null,
      totalArea: null,
      privateArea: null,
      landArea: null,
      bedrooms: null,
      parkingSpaces: null,
      livingRooms: null,
    })
    expect(parseCaixaDescription(null).type).toBe("other")
  })
})

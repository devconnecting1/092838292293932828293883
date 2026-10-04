import { describe, expect, it } from "vitest"

import {
  buildPropertyShareText,
  buildWhatsappShareUrl,
  describePropertyHighlights,
  type PropertyShareInput,
} from "./share-text"

const BASE: PropertyShareInput = {
  code: "IMV-000123",
  title: "Apartamento com varanda gourmet",
  type: "apartment",
  purpose: "sale_rent",
  salePrice: 1200000,
  rentPrice: 5500,
  condoFee: 980,
  bedrooms: 3,
  suites: 1,
  bathrooms: 2,
  parkingSpaces: 2,
  livingArea: 120.5,
  neighborhood: "Jardim Europa",
  city: "São Paulo",
  state: "sp",
  organizationName: "Imobiliária Teste",
}

describe("buildPropertyShareText", () => {
  it("monta título, preços, características e bairro", () => {
    expect(buildPropertyShareText(BASE)).toBe(
      [
        "*Apartamento com varanda gourmet* (IMV-000123)",
        "Apartamento para venda e locação",
        "Venda: R$ 1.200.000",
        "Locação: R$ 5.500/mês",
        "Condomínio: R$ 980/mês",
        "3 quartos (1 suíte) · 2 banheiros · 2 vagas · 120,5 m²",
        "Bairro: Jardim Europa, São Paulo/SP",
        "",
        "Quer agendar uma visita? Responda esta mensagem.",
        "_Imobiliária Teste_",
      ].join("\n")
    )
  })

  it("inclui o link público quando informado e recusa link que não seja http(s)", () => {
    const url = "https://imob-teste.seucrm.com.br/imovel/IMV-000123"
    const text = buildPropertyShareText({ ...BASE, publicUrl: url })

    expect(text).toContain(`Bairro: Jardim Europa, São Paulo/SP\n\nVeja fotos e detalhes: ${url}\n`)

    for (const publicUrl of ["javascript:alert(1)", "https://x.com/a b", "", null]) {
      expect(buildPropertyShareText({ ...BASE, publicUrl })).not.toContain("Veja fotos")
    }
  })

  it("mostra só o preço da finalidade", () => {
    const sale = buildPropertyShareText({ ...BASE, purpose: "sale" })
    const rent = buildPropertyShareText({ ...BASE, purpose: "rent" })

    expect(sale).toContain("Venda: R$ 1.200.000")
    expect(sale).not.toContain("Locação: R$")
    expect(rent).toContain("Locação: R$ 5.500/mês")
    expect(rent).not.toContain("Venda: R$")
  })

  it("nunca expõe rua, número, complemento ou CEP", () => {
    const input = {
      ...BASE,
      street: "Rua Sigilosa",
      streetNumber: "742",
      complement: "Apto 91",
      postalCode: "01234567",
    } as PropertyShareInput

    const text = buildPropertyShareText(input)

    for (const secret of ["Sigilosa", "742", "Apto 91", "01234567", "01234-567"]) {
      expect(text).not.toContain(secret)
    }
  })

  it("junta quebras de linha digitadas e omite o que falta", () => {
    const text = buildPropertyShareText({
      code: "IMV-000001",
      title: "Terreno\n\nplano",
      type: "land",
      purpose: "sale",
      salePrice: null,
      lotArea: 450,
    })

    expect(text.split("\n")[0]).toBe("*Terreno plano* (IMV-000001)")
    expect(text).toContain("450 m² de terreno")
    expect(text).not.toContain("Venda:")
    expect(text).not.toContain("Bairro:")
    expect(text).not.toMatch(/undefined|null|NaN/)
  })
})

describe("describePropertyHighlights", () => {
  it("singular e plural", () => {
    expect(
      describePropertyHighlights({
        ...BASE,
        bedrooms: 1,
        suites: 0,
        bathrooms: 1,
        parkingSpaces: 1,
      })
    ).toBe("1 quarto · 1 banheiro · 1 vaga · 120,5 m²")
  })

  it("sem nada devolve null", () => {
    expect(
      describePropertyHighlights({
        code: "X",
        title: "X",
        type: "other",
        purpose: "sale",
      })
    ).toBeNull()
  })
})

describe("buildWhatsappShareUrl", () => {
  it("usa wa.me sem número e codifica o texto", () => {
    const url = buildWhatsappShareUrl("*Casa* & quintal\nR$ 10")

    expect(url).toBe("https://wa.me/?text=*Casa*%20%26%20quintal%0AR%24%2010")
    expect(new URL(url).searchParams.get("text")).toBe("*Casa* & quintal\nR$ 10")
  })
})

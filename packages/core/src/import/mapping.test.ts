import { describe, expect, it } from "vitest"

import {
  getMissingRequiredGroups,
  mapRowValues,
  setColumnField,
  suggestColumnMapping,
} from "./mapping"
import { parseLeadStage, parsePropertyType, parsePurpose } from "./values"

describe("suggestColumnMapping", () => {
  it("reconhece os nomes de coluna comuns de uma base de contatos", () => {
    expect(
      suggestColumnMapping("clients", [
        "Nome Completo",
        "CPF/CNPJ",
        "E-mail",
        "Telefone",
        "Celular",
        "Cidade",
        "Estado",
        "Observações",
        "Coluna esquisita",
      ])
    ).toEqual(["name", "document", "email", "phone", "whatsapp", "city", "state", "notes", null])
  })

  it("usa Celular como telefone quando não há coluna Telefone", () => {
    expect(suggestColumnMapping("clients", ["Nome", "Celular"])).toEqual(["name", "phone"])
  })

  it("não confunde área do terreno com área útil nem aluguel com venda", () => {
    expect(
      suggestColumnMapping("properties", [
        "Cód.",
        "Tipo do imóvel",
        "Área do terreno",
        "Área útil",
        "Valor do aluguel",
        "Preço de venda",
        "Nº",
        "Dormitórios",
      ])
    ).toEqual([
      "external_code",
      "type",
      "lot_area",
      "living_area",
      "rent_price",
      "sale_price",
      "street_number",
      "bedrooms",
    ])
  })

  it("mapeia a etapa do funil de leads", () => {
    expect(suggestColumnMapping("leads", ["Lead", "WhatsApp", "Status", "Origem"])).toEqual([
      "name",
      "phone",
      "stage",
      "source",
    ])
  })
})

describe("setColumnField", () => {
  it("tira o campo da coluna anterior ao escolher outra", () => {
    expect(setColumnField(["name", "phone", null], 2, "phone")).toEqual(["name", null, "phone"])
    expect(setColumnField(["name", "phone"], 1, null)).toEqual(["name", null])
  })
})

describe("getMissingRequiredGroups", () => {
  it("exige nome e algum contato para clientes", () => {
    expect(getMissingRequiredGroups("clients", ["name", null])).toEqual([
      ["phone", "whatsapp", "email", "document"],
    ])
    expect(getMissingRequiredGroups("clients", ["name", "document"])).toEqual([])
  })

  it("aceita imóvel sem finalidade quando há preço", () => {
    expect(getMissingRequiredGroups("properties", ["type", "rent_price"])).toEqual([])
    expect(getMissingRequiredGroups("properties", ["title"])).toHaveLength(2)
  })
})

describe("mapRowValues", () => {
  it("monta os valores pelos campos mapeados", () => {
    expect(mapRowValues([null, "name", "phone"], ["x", "Ana", "11999998888"])).toEqual({
      name: "Ana",
      phone: "11999998888",
    })
  })
})

describe("valores da planilha para os enums do banco", () => {
  it("entende finalidade, tipo e etapa escritos de várias formas", () => {
    expect(parsePurpose("Venda e Locação")).toBe("sale_rent")
    expect(parsePurpose("ALUGUEL")).toBe("rent")
    expect(parsePropertyType("Apto")).toBe("apartment")
    expect(parsePropertyType("Chácara")).toBe("ranch")
    expect(parsePropertyType("Casa em condomínio")).toBe("condo_house")
    expect(parsePropertyType("Kitnet")).toBe("studio")
    expect(parsePropertyType("castelo")).toBeNull()
    expect(parseLeadStage("Visita agendada")).toBe("visit_scheduled")
    expect(parseLeadStage("Perdido")).toBe("lost")
  })
})

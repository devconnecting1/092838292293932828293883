import { describe, expect, it } from "vitest"

import {
  cleanText,
  normalizeImportDocument,
  normalizeImportEmail,
  normalizeImportPhone,
  normalizeImportPostalCode,
  normalizeImportState,
  normalizeLabel,
  parseImportBoolean,
  parseImportDate,
  parseImportDecimal,
  parseImportInteger,
  phoneKey,
  splitImportList,
} from "./normalize"

describe("normalizeLabel", () => {
  it("tira acento, pontuação e maiúsculas", () => {
    expect(normalizeLabel("  E-mail / Correio Eletrônico ")).toBe("e mail correio eletronico")
    expect(normalizeLabel("Nº")).toBe("n")
  })
})

describe("cleanText", () => {
  it("apara, junta espaços e troca quebra de linha por espaço", () => {
    expect(cleanText("  Rua   das\nFlores\t ")).toBe("Rua das Flores")
    expect(cleanText("   ")).toBeNull()
    expect(cleanText(undefined)).toBeNull()
  })
})

describe("normalizeImportPhone", () => {
  it("deixa só os dígitos com DDD", () => {
    expect(normalizeImportPhone("(11) 98765-4321")).toEqual({ ok: true, value: "11987654321" })
    expect(normalizeImportPhone("11 3333-4444")).toEqual({ ok: true, value: "1133334444" })
  })

  it("tira +55 e o zero da operadora", () => {
    expect(normalizeImportPhone("+55 (21) 99876-5432")).toEqual({ ok: true, value: "21998765432" })
    expect(normalizeImportPhone("011 98765-4321")).toEqual({ ok: true, value: "11987654321" })
  })

  it("usa o primeiro número válido quando a célula tem vários", () => {
    expect(normalizeImportPhone("sem número / (11) 3333-4444")).toEqual({
      ok: true,
      value: "1133334444",
    })
  })

  it("recusa telefone sem DDD, DDD inexistente e celular sem o 9", () => {
    expect(normalizeImportPhone("98765-4321")).toEqual({ ok: false })
    expect(normalizeImportPhone("(20) 98765-4321")).toEqual({ ok: false })
    expect(normalizeImportPhone("(11) 88765-43210")).toEqual({ ok: false })
  })

  it("célula vazia não é erro", () => {
    expect(normalizeImportPhone("  ")).toEqual({ ok: true, value: null })
  })

  it("a chave de duplicidade usa os últimos 11 dígitos", () => {
    expect(phoneKey("11987654321")).toBe("11987654321")
    expect(phoneKey("1133334444")).toBe("1133334444")
  })
})

describe("normalizeImportEmail", () => {
  it("passa para minúsculas e usa o primeiro de uma lista", () => {
    expect(normalizeImportEmail(" Maria@Exemplo.COM.br ")).toEqual({
      ok: true,
      value: "maria@exemplo.com.br",
    })
    expect(normalizeImportEmail("a@x.com; b@y.com")).toEqual({ ok: true, value: "a@x.com" })
  })

  it("recusa e-mail sem domínio, com espaço ou com ponto duplo", () => {
    expect(normalizeImportEmail("maria@")).toEqual({ ok: false })
    expect(normalizeImportEmail("maria silva@x.com")).toEqual({ ok: false })
    expect(normalizeImportEmail("maria..silva@x.com")).toEqual({ ok: false })
  })
})

describe("normalizeImportDocument", () => {
  it("aceita CPF com ou sem máscara", () => {
    expect(normalizeImportDocument("529.982.247-25")).toEqual({
      ok: true,
      value: { document: "52998224725", kind: "pf" },
    })
  })

  it("completa o zero que o Excel apaga do CPF numérico", () => {
    // 012.345.678-90 é válido; no Excel vira 1234567890.
    expect(normalizeImportDocument("1234567890")).toEqual({
      ok: true,
      value: { document: "01234567890", kind: "pf" },
    })
  })

  it("aceita CNPJ numérico e alfanumérico", () => {
    expect(normalizeImportDocument("11.222.333/0001-81")).toEqual({
      ok: true,
      value: { document: "11222333000181", kind: "pj" },
    })
    expect(normalizeImportDocument("12.ABC.345/01DE-35")).toEqual({
      ok: true,
      value: { document: "12ABC34501DE35", kind: "pj" },
    })
  })

  it("recusa dígito verificador errado", () => {
    expect(normalizeImportDocument("529.982.247-24")).toEqual({ ok: false })
    expect(normalizeImportDocument("111.111.111-11")).toEqual({ ok: false })
  })
})

describe("endereço", () => {
  it("completa o zero do CEP", () => {
    expect(normalizeImportPostalCode("1310100")).toEqual({ ok: true, value: "01310100" })
    expect(normalizeImportPostalCode("04521-000")).toEqual({ ok: true, value: "04521000" })
    expect(normalizeImportPostalCode("123")).toEqual({ ok: false })
  })

  it("aceita UF pela sigla ou pelo nome", () => {
    expect(normalizeImportState("sp")).toEqual({ ok: true, value: "SP" })
    expect(normalizeImportState("Espírito Santo")).toEqual({ ok: true, value: "ES" })
    expect(normalizeImportState("Paulista")).toEqual({ ok: false })
  })
})

describe("parseImportDecimal", () => {
  it("lê dinheiro em pt-BR", () => {
    expect(parseImportDecimal("R$ 1.234.567,89")).toEqual({ ok: true, value: 1234567.89 })
    expect(parseImportDecimal("450.000")).toEqual({ ok: true, value: 450000 })
    expect(parseImportDecimal("72,5")).toEqual({ ok: true, value: 72.5 })
  })

  it("lê número com ponto decimal e em inglês", () => {
    expect(parseImportDecimal("72.50")).toEqual({ ok: true, value: 72.5 })
    expect(parseImportDecimal("1,234.56")).toEqual({ ok: true, value: 1234.56 })
    expect(parseImportDecimal("120 m²")).toEqual({ ok: true, value: 120 })
  })

  it("recusa texto", () => {
    expect(parseImportDecimal("a combinar")).toEqual({ ok: false })
    expect(parseImportDecimal("1,2,3")).toEqual({ ok: false })
    expect(parseImportDecimal("")).toEqual({ ok: true, value: null })
  })
})

describe("parseImportInteger", () => {
  it("pega o primeiro número", () => {
    expect(parseImportInteger("3")).toEqual({ ok: true, value: 3 })
    expect(parseImportInteger("2 quartos")).toEqual({ ok: true, value: 2 })
    expect(parseImportInteger("2,0")).toEqual({ ok: true, value: 2 })
    expect(parseImportInteger("nenhum")).toEqual({ ok: false })
  })
})

describe("parseImportBoolean", () => {
  it("entende sim e não", () => {
    expect(parseImportBoolean("Sim")).toEqual({ ok: true, value: true })
    expect(parseImportBoolean("X")).toEqual({ ok: true, value: true })
    expect(parseImportBoolean("NÃO")).toEqual({ ok: true, value: false })
    expect(parseImportBoolean("talvez")).toEqual({ ok: false })
  })
})

describe("parseImportDate", () => {
  it("lê DD/MM/AAAA, DD/MM/AA e AAAA-MM-DD", () => {
    expect(parseImportDate("15/03/1985")).toEqual({ ok: true, value: "1985-03-15" })
    expect(parseImportDate("5-3-85")).toEqual({ ok: true, value: "1985-03-05" })
    expect(parseImportDate("1985-03-15T00:00:00.000Z")).toEqual({ ok: true, value: "1985-03-15" })
  })

  it("lê o número serial do Excel", () => {
    expect(parseImportDate("31121")).toEqual({ ok: true, value: "1985-03-15" })
  })

  it("recusa data que não existe", () => {
    expect(parseImportDate("31/02/2020")).toEqual({ ok: false })
    expect(parseImportDate("ontem")).toEqual({ ok: false })
  })
})

describe("splitImportList", () => {
  it("separa por vírgula, ponto e vírgula ou barra vertical, sem repetir", () => {
    expect(splitImportList("Piscina, churrasqueira; PISCINA | Academia")).toEqual([
      "Piscina",
      "churrasqueira",
      "Academia",
    ])
  })
})

import { describe, expect, it } from "vitest"

import {
  formatBrDate,
  normalizeCityName,
  normalizeListingNumber,
  normalizeNeighborhoodName,
  normalizePlainText,
  normalizeUf,
  parseBrDate,
  parseBrlAmount,
  parseDotDecimal,
  parsePercent,
  parseYesNo,
  toTitleCasePtBr,
} from "./normalize"

describe("normalizePlainText", () => {
  it("tira espaço sobrando das pontas e do meio", () => {
    expect(normalizePlainText(" RUA  SAO PAULO ,  N. 23 ")).toBe("RUA SAO PAULO , N. 23")
  })

  it("troca caracteres de controle por espaço", () => {
    expect(normalizePlainText("RUA\tAB")).toBe("RUA A B")
  })

  it("devolve null para vazio e para o que não é texto", () => {
    expect(normalizePlainText("   ")).toBeNull()
    expect(normalizePlainText(null)).toBeNull()
    expect(normalizePlainText(42)).toBeNull()
  })

  it("respeita o tamanho máximo", () => {
    expect(normalizePlainText("a".repeat(500), 10)).toBe("a".repeat(10))
  })
})

describe("normalizeListingNumber", () => {
  it("aceita os três tamanhos que o arquivo traz", () => {
    expect(normalizeListingNumber(" 1555518212585 ")).toBe("1555518212585")
    expect(normalizeListingNumber("10304791")).toBe("10304791")
    expect(normalizeListingNumber("11284")).toBe("11284")
  })

  it("recusa qualquer coisa que não seja de 1 a 13 dígitos", () => {
    expect(normalizeListingNumber("")).toBeNull()
    expect(normalizeListingNumber("12345678901234")).toBeNull()
    expect(normalizeListingNumber("155551821258X")).toBeNull()
    expect(normalizeListingNumber("1,555")).toBeNull()
  })
})

describe("parseBrlAmount", () => {
  it("lê o formato do arquivo", () => {
    expect(parseBrlAmount("170.000,00")).toBe(170_000)
    expect(parseBrlAmount("134.287,99")).toBe(134_287.99)
    expect(parseBrlAmount("1.845.871,80")).toBe(1_845_871.8)
    expect(parseBrlAmount("18.800.000,00")).toBe(18_800_000)
    expect(parseBrlAmount("8.300,00")).toBe(8_300)
    expect(parseBrlAmount("0,00")).toBe(0)
  })

  it("aceita R$ e a forma sem separador de milhar", () => {
    expect(parseBrlAmount("R$ 170.000,00")).toBe(170_000)
    expect(parseBrlAmount("170000,00")).toBe(170_000)
    expect(parseBrlAmount("170000")).toBe(170_000)
  })

  it("recusa formato estranho em vez de adivinhar", () => {
    expect(parseBrlAmount("170.00")).toBeNull()
    expect(parseBrlAmount("-170.000,00")).toBeNull()
    expect(parseBrlAmount("1.2345,00")).toBeNull()
    expect(parseBrlAmount("Consulte")).toBeNull()
    expect(parseBrlAmount("")).toBeNull()
    expect(parseBrlAmount(null)).toBeNull()
  })
})

describe("parsePercent", () => {
  it("lê o desconto publicado (ponto decimal)", () => {
    expect(parsePercent("39.56")).toBe(39.56)
    expect(parsePercent("0.00")).toBe(0)
    expect(parsePercent("90.00")).toBe(90)
    expect(parsePercent("100")).toBe(100)
  })

  it("aceita vírgula por precaução", () => {
    expect(parsePercent("39,56")).toBe(39.56)
  })

  it("recusa fora de 0 a 100 e lixo", () => {
    expect(parsePercent("101")).toBeNull()
    expect(parsePercent("-5.00")).toBeNull()
    expect(parsePercent("abc")).toBeNull()
    expect(parsePercent("")).toBeNull()
  })
})

describe("parseDotDecimal", () => {
  it("lê os números das áreas", () => {
    expect(parseDotDecimal("75.17")).toBe(75.17)
    expect(parseDotDecimal("3780374.00")).toBe(3_780_374)
    expect(parseDotDecimal("0")).toBe(0)
  })

  it("recusa número com vírgula ou sinal", () => {
    expect(parseDotDecimal("75,17")).toBeNull()
    expect(parseDotDecimal("-1")).toBeNull()
  })
})

describe("normalizeUf", () => {
  it("aceita as 27 unidades federativas, em qualquer caixa", () => {
    expect(normalizeUf("ES ")).toBe("ES")
    expect(normalizeUf(" sp")).toBe("SP")
    expect(normalizeUf("df")).toBe("DF")
  })

  it("recusa sigla inexistente", () => {
    expect(normalizeUf("XX")).toBeNull()
    expect(normalizeUf("BRA")).toBeNull()
    expect(normalizeUf("")).toBeNull()
  })
})

describe("toTitleCasePtBr / cidade e bairro", () => {
  it("troca CAIXA ALTA por capitalização normal", () => {
    expect(normalizeCityName("CARIACICA ")).toBe("Cariacica")
    expect(normalizeCityName("RIO DE JANEIRO")).toBe("Rio de Janeiro")
    expect(normalizeCityName("SAO JOSE DO RIO PRETO")).toBe("Sao Jose do Rio Preto")
    expect(normalizeNeighborhoodName(" TUCUM ")).toBe("Tucum")
  })

  it("mantém letra sozinha e código com número em maiúsculas", () => {
    expect(normalizeCityName("VILA A")).toBe("Vila A")
    expect(normalizeNeighborhoodName("SETOR 1A")).toBe("Setor 1A")
  })

  it("não inventa acento nem troca palavra", () => {
    expect(normalizeCityName("BRASILIA")).toBe("Brasilia")
  })

  it("devolve null quando o campo vem vazio (1 bairro do arquivo)", () => {
    expect(normalizeNeighborhoodName(" ")).toBeNull()
    expect(toTitleCasePtBr(null)).toBeNull()
  })
})

describe("parseYesNo", () => {
  it("lê a coluna Financiamento", () => {
    expect(parseYesNo("Sim")).toBe(true)
    expect(parseYesNo("Não ")).toBe(false)
    expect(parseYesNo("nao")).toBe(false)
  })

  it("devolve null quando o arquivo não disse", () => {
    expect(parseYesNo("")).toBeNull()
    expect(parseYesNo("Consulte")).toBeNull()
    expect(parseYesNo(undefined)).toBeNull()
  })
})

describe("parseBrDate", () => {
  it("lê a data de geração da linha 2", () => {
    expect(parseBrDate("15/09/2026")).toBe("2026-09-15")
  })

  it("recusa data impossível e formato diferente", () => {
    expect(parseBrDate("31/02/2026")).toBeNull()
    expect(parseBrDate("2026-09-15")).toBeNull()
    expect(parseBrDate("1/9/2026")).toBeNull()
    expect(parseBrDate("")).toBeNull()
  })
})

describe("formatBrDate", () => {
  it("mostra a data declarada pela Caixa sem trocar o dia pelo fuso", () => {
    expect(formatBrDate("2026-09-15")).toBe("15/09/2026")
    expect(formatBrDate("2026-01-01")).toBe("01/01/2026")
  })

  it("devolve null para data impossível e formato diferente", () => {
    expect(formatBrDate("2026-02-31")).toBeNull()
    expect(formatBrDate("15/09/2026")).toBeNull()
    expect(formatBrDate("2026-09-15T00:00:00Z")).toBeNull()
    expect(formatBrDate(null)).toBeNull()
  })
})

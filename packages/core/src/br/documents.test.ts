import { describe, expect, it } from "vitest"
import {
  cnpjSchema,
  cpfOrCnpjSchema,
  cpfSchema,
  detectDocumentKind,
  formatCnpj,
  formatCpf,
  formatPhoneBr,
  formatPostalCode,
  isValidCnpj,
  isValidCpf,
  isValidPhoneBr,
  isValidPostalCode,
  normalizeCnpj,
  normalizeCpf,
  normalizePhoneBr,
  normalizePostalCode,
  onlyDigits,
  phoneBrSchema,
  postalCodeSchema,
} from "./documents"

describe("onlyDigits", () => {
  it("remove tudo que não for dígito", () => {
    expect(onlyDigits("123.456-789/00")).toBe("12345678900")
  })
})

describe("CPF", () => {
  it("valida CPFs válidos conhecidos", () => {
    expect(isValidCpf("111.444.777-35")).toBe(true)
    expect(isValidCpf("11144477735")).toBe(true)
  })

  it("rejeita CPFs com dígitos verificadores incorretos", () => {
    expect(isValidCpf("111.444.777-36")).toBe(false)
  })

  it("rejeita sequências repetidas", () => {
    expect(isValidCpf("000.000.000-00")).toBe(false)
    expect(isValidCpf("11111111111")).toBe(false)
  })

  it("rejeita tamanho incorreto", () => {
    expect(isValidCpf("123")).toBe(false)
    expect(isValidCpf("")).toBe(false)
  })

  it("normaliza para apenas dígitos", () => {
    expect(normalizeCpf("111.444.777-35")).toBe("11144477735")
  })

  it("formata um CPF normalizado", () => {
    expect(formatCpf("11144477735")).toBe("111.444.777-35")
  })

  it("lança erro ao formatar CPF com tamanho inválido", () => {
    expect(() => formatCpf("123")).toThrow(RangeError)
  })
})

describe("CNPJ numérico legado", () => {
  it("valida um CNPJ numérico válido conhecido", () => {
    expect(isValidCnpj("11.222.333/0001-81")).toBe(true)
    expect(isValidCnpj("11222333000181")).toBe(true)
  })

  it("rejeita CNPJ numérico com dígito verificador incorreto", () => {
    expect(isValidCnpj("11.222.333/0001-82")).toBe(false)
  })

  it("rejeita sequências repetidas", () => {
    expect(isValidCnpj("00000000000000")).toBe(false)
  })

  it("formata um CNPJ numérico normalizado", () => {
    expect(formatCnpj("11222333000181")).toBe("11.222.333/0001-81")
  })
})

describe("CNPJ alfanumérico (a partir de 07/2026)", () => {
  // Exemplo oficial verificado manualmente (ver comentário-fonte em
  // documents.ts): base "12ABC34501DE" com pesos do módulo 11 e valor
  // ASCII-48 produz os dígitos verificadores "35".
  // Fonte: https://www.serasaexperian.com.br/conteudos/cnpj-alfanumerico/
  const VALID_ALPHANUMERIC_CNPJ = "12.ABC.345/01DE-35"

  it("valida um CNPJ alfanumérico válido", () => {
    expect(isValidCnpj(VALID_ALPHANUMERIC_CNPJ)).toBe(true)
    expect(isValidCnpj("12ABC34501DE35")).toBe(true)
  })

  it("rejeita um CNPJ alfanumérico com dígito verificador incorreto", () => {
    expect(isValidCnpj("12.ABC.345/01DE-36")).toBe(false)
  })

  it("rejeita caracteres inválidos nos dígitos verificadores (devem ser numéricos)", () => {
    expect(isValidCnpj("12ABC34501DEAB")).toBe(false)
  })

  it("normaliza mantendo as letras em maiúsculas", () => {
    expect(normalizeCnpj("12.abc.345/01de-35")).toBe("12ABC34501DE35")
  })

  it("formata um CNPJ alfanumérico normalizado", () => {
    expect(formatCnpj("12ABC34501DE35")).toBe(VALID_ALPHANUMERIC_CNPJ)
  })
})

describe("detectDocumentKind", () => {
  it("detecta CPF (11 dígitos)", () => {
    expect(detectDocumentKind("111.444.777-35")).toBe("pf")
  })

  it("detecta CNPJ numérico (14 dígitos)", () => {
    expect(detectDocumentKind("11.222.333/0001-81")).toBe("pj")
  })

  it("detecta CNPJ alfanumérico (14 caracteres alfanuméricos)", () => {
    expect(detectDocumentKind("12.ABC.345/01DE-35")).toBe("pj")
  })

  it("retorna null para valores que não têm o tamanho de CPF nem CNPJ", () => {
    expect(detectDocumentKind("123")).toBeNull()
  })
})

describe("CEP", () => {
  it("normaliza, valida e formata", () => {
    expect(normalizePostalCode("01001-000")).toBe("01001000")
    expect(isValidPostalCode("01001-000")).toBe(true)
    expect(formatPostalCode("01001000")).toBe("01001-000")
  })

  it("rejeita CEP com tamanho incorreto", () => {
    expect(isValidPostalCode("123")).toBe(false)
    expect(() => formatPostalCode("123")).toThrow(RangeError)
  })
})

describe("Telefone BR", () => {
  it("normaliza removendo o código do país (55)", () => {
    expect(normalizePhoneBr("+55 (11) 91234-5678")).toBe("11912345678")
  })

  it("valida celular com 9º dígito e DDD válido", () => {
    expect(isValidPhoneBr("(11) 91234-5678")).toBe(true)
  })

  it("valida fixo com DDD válido", () => {
    expect(isValidPhoneBr("(11) 3456-7890")).toBe(true)
  })

  it("rejeita DDD inválido", () => {
    expect(isValidPhoneBr("(10) 91234-5678")).toBe(false)
  })

  it("rejeita celular sem o 9º dígito inicial", () => {
    expect(isValidPhoneBr("(11) 81234-5678")).toBe(false)
  })

  it("formata celular e fixo corretamente", () => {
    expect(formatPhoneBr("11912345678")).toBe("(11) 91234-5678")
    expect(formatPhoneBr("1134567890")).toBe("(11) 3456-7890")
  })

  it("lança erro ao formatar telefone inválido", () => {
    expect(() => formatPhoneBr("123")).toThrow(RangeError)
  })
})

describe("schemas zod", () => {
  it("cpfSchema normaliza e valida", () => {
    expect(cpfSchema.parse("111.444.777-35")).toBe("11144477735")
    expect(() => cpfSchema.parse("111.444.777-36")).toThrow()
  })

  it("cnpjSchema normaliza e valida (numérico e alfanumérico)", () => {
    expect(cnpjSchema.parse("11.222.333/0001-81")).toBe("11222333000181")
    expect(cnpjSchema.parse("12.ABC.345/01DE-35")).toBe("12ABC34501DE35")
    expect(() => cnpjSchema.parse("11.222.333/0001-82")).toThrow()
  })

  it("cpfOrCnpjSchema aceita ambos e rejeita inválidos", () => {
    expect(cpfOrCnpjSchema.parse("111.444.777-35")).toBe("11144477735")
    expect(cpfOrCnpjSchema.parse("11.222.333/0001-81")).toBe("11222333000181")
    expect(() => cpfOrCnpjSchema.parse("123")).toThrow()
  })

  it("postalCodeSchema normaliza e valida", () => {
    expect(postalCodeSchema.parse("01001-000")).toBe("01001000")
    expect(() => postalCodeSchema.parse("123")).toThrow()
  })

  it("phoneBrSchema normaliza e valida", () => {
    expect(phoneBrSchema.parse("(11) 91234-5678")).toBe("11912345678")
    expect(() => phoneBrSchema.parse("(10) 91234-5678")).toThrow()
  })
})

import { describe, expect, it } from "vitest"

import { formatBRL, formatLimit } from "./format"

// Espaços não separáveis que o Intl pode usar entre "R$" e o número.
const NON_BREAKING_SPACES = [String.fromCharCode(0x00a0), String.fromCharCode(0x202f)]

describe("formatBRL", () => {
  it("formata centavos em reais no padrão pt-BR", () => {
    expect(formatBRL(193000)).toBe("R$ 1.930,00")
    expect(formatBRL(11500)).toBe("R$ 115,00")
    expect(formatBRL(190)).toBe("R$ 1,90")
    expect(formatBRL(1930000)).toBe("R$ 19.300,00")
    expect(formatBRL(0)).toBe("R$ 0,00")
  })

  it("usa espaço comum entre o símbolo e o número", () => {
    const formatted = formatBRL(32000)
    expect(formatted).toBe("R$ 320,00")
    expect(NON_BREAKING_SPACES.some((space) => formatted.includes(space))).toBe(false)
  })

  it("omite ,00 só quando pedido e o valor é inteiro", () => {
    expect(formatBRL(11500, { omitZeroCents: true })).toBe("R$ 115")
    expect(formatBRL(199000, { omitZeroCents: true })).toBe("R$ 1.990")
    expect(formatBRL(11550, { omitZeroCents: true })).toBe("R$ 115,50")
  })

  it("arredonda frações de centavo", () => {
    expect(formatBRL(12345.6)).toBe("R$ 123,46")
    expect(formatBRL(-0.4)).toBe("R$ 0,00")
  })

  it("formata negativos e trata valor não finito como zero", () => {
    expect(formatBRL(-500)).toBe("-R$ 5,00")
    expect(formatBRL(Number.NaN)).toBe("R$ 0,00")
    expect(formatBRL(Number.POSITIVE_INFINITY)).toBe("R$ 0,00")
  })
})

describe("formatLimit", () => {
  it("segue a convenção -1 ilimitado e 0 não incluso", () => {
    expect(formatLimit(-1)).toBe("Ilimitado")
    expect(formatLimit(0)).toBe("Não incluso")
    expect(formatLimit(Number.NaN)).toBe("—")
  })

  it("formata o número com unidade opcional", () => {
    expect(formatLimit(300)).toBe("300")
    expect(formatLimit(2000)).toBe("2.000")
    expect(formatLimit(100, "GB")).toBe("100 GB")
  })
})

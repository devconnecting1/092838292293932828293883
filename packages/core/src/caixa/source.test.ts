import { describe, expect, it } from "vitest"

import {
  buildCaixaListingUrl,
  buildCaixaPhotoUrl,
  CAIXA_PHOTO_INDEX_LIMIT,
  isCaixaPhotosEnabled,
  isCaixaUrl,
} from "./source"

describe("buildCaixaPhotoUrl", () => {
  // Os três casos foram conferidos contra o servidor da Caixa em 16/09/2026.
  it("monta a URL da primeira foto de um número de 13 dígitos", () => {
    expect(buildCaixaPhotoUrl("8787709515913")).toBe(
      "https://venda-imoveis.caixa.gov.br/fotos/F878770951591321.jpg"
    )
  })

  it("preenche com zeros à esquerda até 13 dígitos", () => {
    expect(buildCaixaPhotoUrl("10304791")).toBe(
      "https://venda-imoveis.caixa.gov.br/fotos/F000001030479121.jpg"
    )
    expect(buildCaixaPhotoUrl("11284")).toBe(
      "https://venda-imoveis.caixa.gov.br/fotos/F000000001128421.jpg"
    )
  })

  it("usa 22 e 23 para a segunda e a terceira foto", () => {
    expect(buildCaixaPhotoUrl("10304791", 1)).toBe(
      "https://venda-imoveis.caixa.gov.br/fotos/F000001030479122.jpg"
    )
    expect(buildCaixaPhotoUrl("10304791", 2)).toBe(
      "https://venda-imoveis.caixa.gov.br/fotos/F000001030479123.jpg"
    )
  })

  it("não inventa URL além das fotos conhecidas", () => {
    expect(buildCaixaPhotoUrl("10304791", CAIXA_PHOTO_INDEX_LIMIT)).toBeNull()
    expect(buildCaixaPhotoUrl("10304791", -1)).toBeNull()
    expect(buildCaixaPhotoUrl("10304791", 1.5)).toBeNull()
  })

  it("recusa número que não seja de 1 a 13 dígitos", () => {
    expect(buildCaixaPhotoUrl("")).toBeNull()
    expect(buildCaixaPhotoUrl("12345678901234")).toBeNull()
    expect(buildCaixaPhotoUrl("87877095159 13")).toBeNull()
    expect(buildCaixaPhotoUrl("../../etc/passwd")).toBeNull()
  })
})

describe("buildCaixaListingUrl", () => {
  it("aponta para a página oficial do imóvel", () => {
    expect(buildCaixaListingUrl("8787709515913")).toBe(
      "https://venda-imoveis.caixa.gov.br/sistema/detalhe-imovel.asp?hdnimovel=8787709515913"
    )
  })

  it("recusa número inválido", () => {
    expect(buildCaixaListingUrl("abc")).toBeNull()
  })
})

describe("isCaixaUrl", () => {
  it("aceita só https no host da Caixa", () => {
    expect(isCaixaUrl("https://venda-imoveis.caixa.gov.br/sistema/detalhe-imovel.asp?x=1")).toBe(
      true
    )
    expect(isCaixaUrl("http://venda-imoveis.caixa.gov.br/sistema/detalhe-imovel.asp")).toBe(false)
    expect(isCaixaUrl("https://venda-imoveis.caixa.gov.br.exemplo.invalid/x")).toBe(false)
    expect(isCaixaUrl("https://outro.invalid/sistema/detalhe-imovel.asp")).toBe(false)
    expect(isCaixaUrl("javascript:alert(1)")).toBe(false)
    expect(isCaixaUrl("")).toBe(false)
    expect(isCaixaUrl(null)).toBe(false)
  })
})

describe("isCaixaPhotosEnabled", () => {
  it("fica ligado quando a variável não está definida", () => {
    expect(isCaixaPhotosEnabled(undefined)).toBe(true)
    expect(isCaixaPhotosEnabled("")).toBe(true)
    expect(isCaixaPhotosEnabled("  ")).toBe(true)
    expect(isCaixaPhotosEnabled("true")).toBe(true)
    expect(isCaixaPhotosEnabled("1")).toBe(true)
  })

  it("desliga todas as fotos com um valor de desligamento", () => {
    for (const value of ["0", "false", "FALSE", "off", "no", "nao", "Não", "desligado"]) {
      expect(isCaixaPhotosEnabled(value)).toBe(false)
    }
  })
})

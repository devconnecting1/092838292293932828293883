import { describe, expect, it } from "vitest"

import {
  finishTenantSlugInput,
  getTenantSlugIssue,
  isValidTenantSlug,
  RESERVED_SUBDOMAINS,
  sanitizeTenantSlugInput,
} from "./slug"

describe("sanitizeTenantSlugInput (campo de link no cadastro)", () => {
  it("tira acentos e maiúsculas do que a pessoa digita", () => {
    expect(sanitizeTenantSlugInput("Horizonte Imóveis")).toBe("horizonte-imoveis")
    expect(sanitizeTenantSlugInput("Imobiliária São João & Cia")).toBe("imobiliaria-sao-joao-cia")
    expect(isValidTenantSlug(sanitizeTenantSlugInput("Construção Ágil"))).toBe(true)
  })

  it("não vira slug inválido quando digitam um endereço de rua", () => {
    const slug = finishTenantSlugInput("Rua das Flores, 123 - Centro")
    expect(slug).toBe("rua-das-flores-123-centro")
    expect(isValidTenantSlug(slug)).toBe(true)
  })

  it("troca sequências de espaço ou pontuação por um único hífen", () => {
    expect(sanitizeTenantSlugInput("a  b")).toBe("a-b")
    expect(sanitizeTenantSlugInput("a--b")).toBe("a-b")
    expect(sanitizeTenantSlugInput("a- b")).toBe("a-b")
    expect(sanitizeTenantSlugInput("imob.sp_2026")).toBe("imob-sp-2026")
  })

  it("mantém o hífen do fim enquanto digita, mas não o do início", () => {
    expect(sanitizeTenantSlugInput("horizonte ")).toBe("horizonte-")
    expect(sanitizeTenantSlugInput("-horizonte")).toBe("horizonte")
    expect(sanitizeTenantSlugInput("  ")).toBe("")
  })

  it("respeita o tamanho máximo", () => {
    expect(sanitizeTenantSlugInput("a".repeat(80))).toHaveLength(60)
    expect(sanitizeTenantSlugInput("a".repeat(80), 48)).toHaveLength(48)
  })
})

describe("finishTenantSlugInput", () => {
  it("remove o hífen do fim ao sair do campo", () => {
    expect(finishTenantSlugInput("horizonte-")).toBe("horizonte")
    expect(finishTenantSlugInput("horizonte-imoveis")).toBe("horizonte-imoveis")
    expect(finishTenantSlugInput("Horizonte Imóveis!")).toBe("horizonte-imoveis")
  })
})

describe("isValidTenantSlug", () => {
  it("aceita rótulos DNS simples", () => {
    expect(isValidTenantSlug("teste")).toBe(true)
    expect(isValidTenantSlug("horizonte-imoveis")).toBe(true)
    expect(isValidTenantSlug("imob-2026")).toBe(true)
    expect(isValidTenantSlug("abc")).toBe(true)
    expect(isValidTenantSlug("a".repeat(60))).toBe(true)
  })

  it("recusa tamanho fora de 3 a 60", () => {
    expect(getTenantSlugIssue("ab")).toBe("length")
    expect(getTenantSlugIssue("a".repeat(61))).toBe("length")
    expect(getTenantSlugIssue("")).toBe("length")
  })

  it("recusa maiúsculas, acentos, ponto, sublinhado e espaço", () => {
    expect(getTenantSlugIssue("Teste")).toBe("characters")
    expect(getTenantSlugIssue("imóveis")).toBe("characters")
    expect(getTenantSlugIssue("a.b.c")).toBe("characters")
    expect(getTenantSlugIssue("te_ste")).toBe("characters")
    expect(getTenantSlugIssue("te ste")).toBe("characters")
  })

  it("recusa hífen nas pontas", () => {
    expect(getTenantSlugIssue("-teste")).toBe("hyphens")
    expect(getTenantSlugIssue("teste-")).toBe("hyphens")
  })

  it("recusa hífens seguidos em qualquer posição", () => {
    expect(getTenantSlugIssue("tes--te")).toBe("hyphens")
    expect(getTenantSlugIssue("ab--cd")).toBe("hyphens")
  })

  it("recusa rótulos IDN/punycode (xn--)", () => {
    expect(getTenantSlugIssue("xn--imveis-xxa")).toBe("hyphens")
    expect(isValidTenantSlug("xn--80ak6aa92e")).toBe(false)
  })

  it("recusa subdomínios reservados", () => {
    for (const reserved of ["www", "app", "api", "admin", "feeds", "captar", "convite"]) {
      expect(getTenantSlugIssue(reserved)).toBe("reserved")
    }
  })

  it("reserva status (página de status pública no domínio raiz)", () => {
    expect(RESERVED_SUBDOMAINS.has("status")).toBe(true)
    expect(getTenantSlugIssue("status")).toBe("reserved")
  })

  it("recusa reservados curtos pela regra de tamanho", () => {
    expect(isValidTenantSlug("lp")).toBe(false)
  })

  it("recusa valores que não são texto", () => {
    expect(isValidTenantSlug(null)).toBe(false)
    expect(isValidTenantSlug(undefined)).toBe(false)
    expect(isValidTenantSlug(123)).toBe(false)
  })
})

describe("RESERVED_SUBDOMAINS", () => {
  it("só tem entradas em minúsculas e sem espaços", () => {
    for (const value of RESERVED_SUBDOMAINS) {
      expect(value).toBe(value.trim().toLowerCase())
    }
  })

  it("tem a mesma quantidade da lista do banco (private.is_reserved_subdomain)", () => {
    expect(RESERVED_SUBDOMAINS.size).toBe(39)
  })
})

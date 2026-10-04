import { describe, expect, it } from "vitest"

import {
  classifyHost,
  getProtocolForRootDomain,
  getSharedCookieDomain,
  normalizeRootDomain,
  parseTenantSlugFromHost,
} from "./host"

const PROD = "seucrm.com.br"
const DEV = "localhost:3000"

describe("classifyHost em produção", () => {
  it("reconhece a raiz", () => {
    expect(classifyHost("seucrm.com.br", PROD)).toEqual({ kind: "root" })
    expect(classifyHost("SEUCRM.com.br", PROD)).toEqual({ kind: "root" })
    expect(classifyHost("seucrm.com.br.", PROD)).toEqual({ kind: "root" })
    expect(classifyHost("seucrm.com.br:443", PROD)).toEqual({ kind: "root" })
  })

  it("reconhece o subdomínio da imobiliária", () => {
    expect(classifyHost("teste.seucrm.com.br", PROD)).toEqual({
      kind: "tenant",
      slug: "teste",
    })
    expect(classifyHost("Horizonte-Imoveis.seucrm.com.br", PROD)).toEqual({
      kind: "tenant",
      slug: "horizonte-imoveis",
    })
  })

  it("trata www à parte", () => {
    expect(classifyHost("www.seucrm.com.br", PROD)).toEqual({ kind: "www" })
  })

  it("recusa subdomínio reservado, inválido ou com vários níveis", () => {
    expect(classifyHost("api.seucrm.com.br", PROD)).toEqual({
      kind: "invalid-tenant",
    })
    expect(classifyHost("xn--imveis-xxa.seucrm.com.br", PROD)).toEqual({
      kind: "invalid-tenant",
    })
    expect(classifyHost("a.teste.seucrm.com.br", PROD)).toEqual({
      kind: "invalid-tenant",
    })
    expect(classifyHost("-teste.seucrm.com.br", PROD)).toEqual({
      kind: "invalid-tenant",
    })
    expect(classifyHost("te_ste.seucrm.com.br", PROD)).toEqual({
      kind: "invalid-tenant",
    })
  })

  it("não confunde domínios parecidos com a raiz", () => {
    expect(classifyHost("teste.seucrm.com.br.evil.com", PROD)).toEqual({
      kind: "external",
    })
    expect(classifyHost("evilseucrm.com.br", PROD)).toEqual({
      kind: "external",
    })
    expect(classifyHost("teste.seucrm.com.br:8080", PROD)).toEqual({
      kind: "external",
    })
    expect(classifyHost("projeto.vercel.app", PROD)).toEqual({
      kind: "external",
    })
  })

  it("trata host ausente ou malformado como externo", () => {
    expect(classifyHost(null, PROD)).toEqual({ kind: "external" })
    expect(classifyHost("", PROD)).toEqual({ kind: "external" })
    expect(classifyHost("teste.seucrm.com.br/x", PROD)).toEqual({
      kind: "external",
    })
    expect(classifyHost("user@teste.seucrm.com.br", PROD)).toEqual({
      kind: "external",
    })
  })
})

describe("classifyHost em desenvolvimento", () => {
  it("usa a porta da raiz", () => {
    expect(classifyHost("localhost:3000", DEV)).toEqual({ kind: "root" })
    expect(classifyHost("teste.localhost:3000", DEV)).toEqual({
      kind: "tenant",
      slug: "teste",
    })
    expect(classifyHost("www.localhost:3000", DEV)).toEqual({ kind: "www" })
    expect(classifyHost("naoexiste.localhost:3000", DEV)).toEqual({
      kind: "tenant",
      slug: "naoexiste",
    })
  })

  it("recusa outra porta e outros hosts", () => {
    expect(classifyHost("teste.localhost:4000", DEV)).toEqual({
      kind: "external",
    })
    expect(classifyHost("localhost", DEV)).toEqual({ kind: "external" })
    expect(classifyHost("127.0.0.1:3000", DEV)).toEqual({ kind: "external" })
  })
})

describe("parseTenantSlugFromHost", () => {
  it("só devolve slug para subdomínio válido", () => {
    expect(parseTenantSlugFromHost("teste.localhost:3000", DEV)).toBe("teste")
    expect(parseTenantSlugFromHost("localhost:3000", DEV)).toBeNull()
    expect(parseTenantSlugFromHost("www.localhost:3000", DEV)).toBeNull()
    expect(parseTenantSlugFromHost("admin.localhost:3000", DEV)).toBeNull()
  })
})

describe("normalizeRootDomain", () => {
  it("remove protocolo, barra final e maiúsculas", () => {
    expect(normalizeRootDomain("https://SeuCRM.com.br/")).toBe("seucrm.com.br")
    expect(normalizeRootDomain(" localhost:3000 ")).toBe("localhost:3000")
  })

  it("recusa valores que não são host", () => {
    expect(normalizeRootDomain("")).toBeNull()
    expect(normalizeRootDomain("seucrm.com.br/app")).toBeNull()
    expect(normalizeRootDomain("seu crm.com.br")).toBeNull()
    expect(normalizeRootDomain(undefined)).toBeNull()
  })
})

describe("getProtocolForRootDomain", () => {
  it("usa http só em localhost e IP", () => {
    expect(getProtocolForRootDomain(DEV)).toBe("http")
    expect(getProtocolForRootDomain("192.168.0.10:3000")).toBe("http")
    expect(getProtocolForRootDomain(PROD)).toBe("https")
  })
})

describe("entradas enormes ou repetitivas (sem ReDoS)", () => {
  // Folga generosa para máquinas lentas de CI; o esperado é bem abaixo de 1 ms.
  const FAST_MS = 50

  function timed<T>(run: () => T) {
    const start = performance.now()
    const result = run()
    return { result, elapsed: performance.now() - start }
  }

  it("recusa rápido muitas barras seguidas", () => {
    const { result, elapsed } = timed(() => normalizeRootDomain("/".repeat(50_000) + "x"))
    expect(result).toBeNull()
    expect(elapsed).toBeLessThan(FAST_MS)
  })

  it("recusa rápido domínio com barras finais em excesso", () => {
    const { result, elapsed } = timed(() =>
      normalizeRootDomain(`https://seucrm.com.br${"/".repeat(50_000)}`)
    )
    expect(result).toBeNull()
    expect(elapsed).toBeLessThan(FAST_MS)
  })

  it("trata rápido host com 10 mil pontos", () => {
    const { result, elapsed } = timed(() => classifyHost(".".repeat(10_000), PROD))
    expect(result).toEqual({ kind: "external" })
    expect(elapsed).toBeLessThan(FAST_MS)
  })

  it("recusa host acima do limite de tamanho", () => {
    const long = `${"a".repeat(320)}.seucrm.com.br`
    const { result, elapsed } = timed(() => classifyHost(long, PROD))
    expect(result).toEqual({ kind: "external" })
    expect(elapsed).toBeLessThan(FAST_MS)
    expect(normalizeRootDomain(long)).toBeNull()
  })

  it("mantém os casos comuns", () => {
    expect(normalizeRootDomain("https://seucrm.com.br///")).toBe("seucrm.com.br")
    expect(normalizeRootDomain("http://localhost:3000/")).toBe("localhost:3000")
    expect(classifyHost("seucrm.com.br.", PROD)).toEqual({ kind: "root" })
    expect(classifyHost("teste.seucrm.com.br.", PROD)).toEqual({ kind: "tenant", slug: "teste" })
    expect(classifyHost("seucrm.com.br..", PROD)).toEqual({ kind: "external" })
  })
})

describe("getSharedCookieDomain", () => {
  it("compartilha o cookie entre subdomínios em domínio real", () => {
    expect(getSharedCookieDomain(PROD)).toBe(".seucrm.com.br")
  })

  it("mantém o cookie só no host em localhost e IP", () => {
    expect(getSharedCookieDomain(DEV)).toBeNull()
    expect(getSharedCookieDomain("app.localhost:3000")).toBeNull()
    expect(getSharedCookieDomain("127.0.0.1:3000")).toBeNull()
    expect(getSharedCookieDomain("intranet")).toBeNull()
  })
})

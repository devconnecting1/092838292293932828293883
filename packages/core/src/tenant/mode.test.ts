import { describe, expect, it } from "vitest"

import { normalizeSiteOrigin, resolveTenancyConfig, resolveTenancyMode } from "./mode"

describe("resolveTenancyMode", () => {
  it("usa subdomain quando há domínio raiz", () => {
    expect(resolveTenancyMode(undefined, "seucrm.com.br")).toBe("subdomain")
    expect(resolveTenancyMode("", "localhost:3000")).toBe("subdomain")
    expect(resolveTenancyMode("subdomain", "seucrm.com.br")).toBe("subdomain")
  })

  it("usa single-host sem domínio raiz, sem lançar", () => {
    expect(resolveTenancyMode(undefined, undefined)).toBe("single-host")
    expect(resolveTenancyMode(undefined, "")).toBe("single-host")
    expect(resolveTenancyMode("subdomain", null)).toBe("single-host")
  })

  it("respeita single-host explícito mesmo com domínio raiz", () => {
    expect(resolveTenancyMode("single-host", "seucrm.com.br")).toBe("single-host")
    expect(resolveTenancyMode(" SINGLE-HOST ", "seucrm.com.br")).toBe("single-host")
  })

  it("trata valor desconhecido como ausente", () => {
    expect(resolveTenancyMode("multi", "seucrm.com.br")).toBe("subdomain")
    expect(resolveTenancyMode("multi", undefined)).toBe("single-host")
  })

  it("trata domínio raiz inválido como ausente", () => {
    expect(resolveTenancyMode(undefined, "seucrm.com.br/app")).toBe("single-host")
  })
})

describe("normalizeSiteOrigin", () => {
  it("extrai a origem de URLs completas", () => {
    expect(normalizeSiteOrigin("https://crm.exemplo.com.br/")).toBe("https://crm.exemplo.com.br")
    expect(normalizeSiteOrigin("http://localhost:3000/painel")).toBe("http://localhost:3000")
  })

  it("aceita host sem protocolo (variáveis da Vercel)", () => {
    expect(normalizeSiteOrigin("plataforma.vercel.app")).toBe("https://plataforma.vercel.app")
    expect(normalizeSiteOrigin("localhost:3000")).toBe("http://localhost:3000")
  })

  it("recusa valores que não são http(s)", () => {
    expect(normalizeSiteOrigin("")).toBeNull()
    expect(normalizeSiteOrigin(undefined)).toBeNull()
    expect(normalizeSiteOrigin("ftp://exemplo.com")).toBeNull()
    expect(normalizeSiteOrigin("javascript:alert(1)")).toBeNull()
  })
})

describe("resolveTenancyConfig", () => {
  it("monta a configuração de subdomínio", () => {
    expect(
      resolveTenancyConfig({
        rootDomain: "https://SeuCRM.com.br/",
        siteUrl: "https://x.vercel.app",
      })
    ).toEqual({ mode: "subdomain", rootDomain: "seucrm.com.br" })
  })

  it("monta a configuração de host único", () => {
    expect(resolveTenancyConfig({ siteUrl: "https://plataforma.vercel.app" })).toEqual({
      mode: "single-host",
      siteOrigin: "https://plataforma.vercel.app",
    })
    expect(
      resolveTenancyConfig({
        configuredMode: "single-host",
        rootDomain: "seucrm.com.br",
        siteUrl: "http://localhost:3000",
      })
    ).toEqual({ mode: "single-host", siteOrigin: "http://localhost:3000" })
  })

  it("aceita host único sem origem configurada", () => {
    expect(resolveTenancyConfig({})).toEqual({
      mode: "single-host",
      siteOrigin: null,
    })
  })
})

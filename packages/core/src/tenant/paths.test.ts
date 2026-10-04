import { describe, expect, it } from "vitest"

import type { TenancyConfig } from "./mode"
import { getLegacyPublicRedirect, getTenantPublicRewrite, resolveRequestTenancy } from "./paths"

const SUBDOMAIN: TenancyConfig = {
  mode: "subdomain",
  rootDomain: "localhost:3000",
}
const SINGLE: TenancyConfig = {
  mode: "single-host",
  siteOrigin: "http://localhost:3000",
}

describe("resolveRequestTenancy", () => {
  it("classifica o host no modo subdomain", () => {
    expect(resolveRequestTenancy(SUBDOMAIN, "localhost:3000")).toEqual({
      kind: "root",
    })
    expect(resolveRequestTenancy(SUBDOMAIN, "teste.localhost:3000")).toEqual({
      kind: "tenant",
      slug: "teste",
    })
    expect(resolveRequestTenancy(SUBDOMAIN, "www.localhost:3000")).toEqual({
      kind: "www",
    })
    expect(resolveRequestTenancy(SUBDOMAIN, "api.localhost:3000")).toEqual({
      kind: "invalid-tenant",
    })
  })

  it("ignora o host no modo single-host", () => {
    expect(resolveRequestTenancy(SINGLE, "teste.localhost:3000")).toEqual({
      kind: "single-host",
    })
    expect(resolveRequestTenancy(SINGLE, "plataforma.vercel.app")).toEqual({
      kind: "single-host",
    })
  })
})

describe("getTenantPublicRewrite", () => {
  it("insere o slug nas rotas públicas", () => {
    expect(getTenantPublicRewrite("/lp/casa", "teste")).toBe("/lp/teste/casa")
    expect(getTenantPublicRewrite("/lp/casa/privacidade", "teste")).toBe(
      "/lp/teste/casa/privacidade"
    )
    expect(getTenantPublicRewrite("/captar", "teste")).toBe("/captar/teste")
    expect(getTenantPublicRewrite("/imovel/IMV-000123", "teste")).toBe("/imovel/teste/IMV-000123")
    expect(getTenantPublicRewrite("/api/feeds/vrsync.xml", "teste")).toBe(
      "/api/feeds/teste/vrsync.xml"
    )
  })

  it("não mexe nas rotas do CRM nem em prefixos parecidos", () => {
    expect(getTenantPublicRewrite("/painel", "teste")).toBeNull()
    expect(getTenantPublicRewrite("/captacao", "teste")).toBeNull()
    expect(getTenantPublicRewrite("/lpx", "teste")).toBeNull()
    expect(getTenantPublicRewrite("/convite/abc", "teste")).toBeNull()
    expect(getTenantPublicRewrite("/imoveis", "teste")).toBeNull()
    expect(getTenantPublicRewrite("/imoveis/IMV-000123", "teste")).toBeNull()
  })
})

describe("getLegacyPublicRedirect", () => {
  it("leva as rotas longas ao caminho curto", () => {
    expect(getLegacyPublicRedirect("/lp/teste/casa")).toEqual({
      slug: "teste",
      path: "/lp/casa",
    })
    expect(getLegacyPublicRedirect("/lp/Teste/casa/privacidade")).toEqual({
      slug: "teste",
      path: "/lp/casa/privacidade",
    })
    expect(getLegacyPublicRedirect("/captar/teste")).toEqual({
      slug: "teste",
      path: "/captar",
    })
    expect(getLegacyPublicRedirect("/imovel/Teste/IMV-000123")).toEqual({
      slug: "teste",
      path: "/imovel/IMV-000123",
    })
  })

  it("não redireciona o feed, nem caminhos incompletos", () => {
    expect(getLegacyPublicRedirect("/api/feeds/teste/vrsync.xml")).toBeNull()
    expect(getLegacyPublicRedirect("/lp/teste")).toBeNull()
    expect(getLegacyPublicRedirect("/lp")).toBeNull()
    expect(getLegacyPublicRedirect("/captar")).toBeNull()
    expect(getLegacyPublicRedirect("/captacao/teste")).toBeNull()
    expect(getLegacyPublicRedirect("/imovel/IMV-000123")).toBeNull()
    expect(getLegacyPublicRedirect("/imoveis/teste/IMV-000123")).toBeNull()
  })

  it("recusa segmento malformado", () => {
    expect(getLegacyPublicRedirect("/captar/%E0%A4%A")).toBeNull()
  })
})

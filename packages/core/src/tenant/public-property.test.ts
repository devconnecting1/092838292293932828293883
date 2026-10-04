import { describe, expect, it } from "vitest"

import type { TenancyConfig } from "./mode"
import {
  normalizePublicPropertyCode,
  PUBLIC_PROPERTY_PATH_PREFIX,
  publicPropertyPath,
  publicPropertyUrl,
} from "./public-property"

const PROD: TenancyConfig = { mode: "subdomain", rootDomain: "seucrm.com.br" }
const DEV: TenancyConfig = { mode: "subdomain", rootDomain: "localhost:3000" }
const SINGLE: TenancyConfig = {
  mode: "single-host",
  siteOrigin: "https://plataforma.vercel.app",
}
const SINGLE_NO_ORIGIN: TenancyConfig = { mode: "single-host", siteOrigin: null }

describe("normalizePublicPropertyCode", () => {
  it("aceita o código de referência em qualquer caixa e devolve em maiúsculas", () => {
    expect(normalizePublicPropertyCode("IMV-000123")).toBe("IMV-000123")
    expect(normalizePublicPropertyCode(" imv-000123 ")).toBe("IMV-000123")
    expect(normalizePublicPropertyCode("imv%2D000123")).toBe("IMV-000123")
  })

  it("recusa valores que não servem de endereço", () => {
    expect(normalizePublicPropertyCode("")).toBeNull()
    expect(normalizePublicPropertyCode(null)).toBeNull()
    expect(normalizePublicPropertyCode(undefined)).toBeNull()
    expect(normalizePublicPropertyCode("IMV--1")).toBeNull()
    expect(normalizePublicPropertyCode("-IMV1")).toBeNull()
    expect(normalizePublicPropertyCode("IMV 000123")).toBeNull()
    expect(normalizePublicPropertyCode("../painel")).toBeNull()
    expect(normalizePublicPropertyCode("IMV-1/../../x")).toBeNull()
    expect(normalizePublicPropertyCode("%E0%A4%A")).toBeNull()
    expect(normalizePublicPropertyCode("A".repeat(41))).toBeNull()
  })
})

describe("publicPropertyPath / publicPropertyUrl", () => {
  it("usa o caminho curto no subdomínio", () => {
    expect(PUBLIC_PROPERTY_PATH_PREFIX).toBe("/imovel")
    expect(publicPropertyPath(PROD, "teste", "IMV-000123")).toBe("/imovel/IMV-000123")
    expect(publicPropertyPath(PROD, "teste", "imv-000123")).toBe("/imovel/IMV-000123")
    expect(publicPropertyUrl(PROD, "teste", "IMV-000123")).toBe(
      "https://teste.seucrm.com.br/imovel/IMV-000123"
    )
    expect(publicPropertyUrl(DEV, "teste", "IMV-000123")).toBe(
      "http://teste.localhost:3000/imovel/IMV-000123"
    )
  })

  it("usa a rota longa no host único", () => {
    expect(publicPropertyPath(SINGLE, "teste", "IMV-000123")).toBe("/imovel/teste/IMV-000123")
    expect(publicPropertyUrl(SINGLE, "teste", "IMV-000123")).toBe(
      "https://plataforma.vercel.app/imovel/teste/IMV-000123"
    )
    expect(publicPropertyPath(SINGLE_NO_ORIGIN, "teste", "IMV-000123")).toBe(
      "/imovel/teste/IMV-000123"
    )
    expect(() => publicPropertyUrl(SINGLE_NO_ORIGIN, "teste", "IMV-000123")).toThrow(
      /NEXT_PUBLIC_SITE_URL/
    )
  })

  it("recusa código ou slug inválido", () => {
    expect(() => publicPropertyPath(PROD, "teste", "IMV 1")).toThrow()
    expect(() => publicPropertyUrl(PROD, "api", "IMV-000123")).toThrow()
    expect(() => publicPropertyPath(SINGLE, "evil.com#", "IMV-000123")).toThrow()
  })
})

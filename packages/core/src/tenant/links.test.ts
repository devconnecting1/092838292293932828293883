import { describe, expect, it } from "vitest"

import {
  buildAppOriginFor,
  buildAppUrlFor,
  buildCapturePathFor,
  buildCaptureUrlFor,
  buildInvitationUrlFor,
  buildLandingPagePathFor,
  buildLandingPageUrlFor,
  buildPortalFeedUrlFor,
  buildTenantLinkPreviewFor,
  buildTenantOriginFor,
  buildTenantUrlFor,
} from "./links"
import type { TenancyConfig } from "./mode"

const PROD: TenancyConfig = { mode: "subdomain", rootDomain: "seucrm.com.br" }
const DEV: TenancyConfig = { mode: "subdomain", rootDomain: "localhost:3000" }
const SINGLE: TenancyConfig = {
  mode: "single-host",
  siteOrigin: "https://plataforma.vercel.app",
}
const SINGLE_NO_ORIGIN: TenancyConfig = {
  mode: "single-host",
  siteOrigin: null,
}

describe("modo subdomain", () => {
  it("monta origens da raiz e do subdomínio", () => {
    expect(buildAppOriginFor(PROD)).toBe("https://seucrm.com.br")
    expect(buildAppUrlFor(PROD, "/imobiliarias")).toBe("https://seucrm.com.br/imobiliarias")
    expect(buildTenantOriginFor(PROD, "teste")).toBe("https://teste.seucrm.com.br")
    expect(buildTenantUrlFor(PROD, "teste", "painel")).toBe("https://teste.seucrm.com.br/painel")
    expect(buildTenantUrlFor(DEV, "teste", "/painel")).toBe("http://teste.localhost:3000/painel")
  })

  it("usa caminhos curtos nas páginas públicas", () => {
    expect(buildLandingPagePathFor(PROD, "teste", "casa-na-praia")).toBe("/lp/casa-na-praia")
    expect(buildLandingPageUrlFor(PROD, "teste", "casa-na-praia")).toBe(
      "https://teste.seucrm.com.br/lp/casa-na-praia"
    )
    expect(buildCapturePathFor(PROD, "teste")).toBe("/captar")
    expect(buildCaptureUrlFor(DEV, "teste")).toBe("http://teste.localhost:3000/captar")
    expect(buildPortalFeedUrlFor(PROD, "teste", "abc123")).toBe(
      "https://teste.seucrm.com.br/api/feeds/vrsync.xml?token=abc123"
    )
    expect(buildInvitationUrlFor(PROD, "teste", "f00d")).toBe(
      "https://teste.seucrm.com.br/convite/f00d"
    )
  })

  it("recusa slug inválido ou reservado", () => {
    expect(() => buildTenantOriginFor(PROD, "api")).toThrow()
    expect(() => buildTenantOriginFor(PROD, "evil.com#")).toThrow()
    expect(() => buildCaptureUrlFor(PROD, "xn--abc")).toThrow()
  })
})

describe("modo single-host", () => {
  it("usa o host único para a raiz e para a imobiliária", () => {
    expect(buildAppOriginFor(SINGLE)).toBe("https://plataforma.vercel.app")
    expect(buildTenantOriginFor(SINGLE, "teste")).toBe("https://plataforma.vercel.app")
    expect(buildTenantUrlFor(SINGLE, "teste", "/painel")).toBe(
      "https://plataforma.vercel.app/painel"
    )
  })

  it("usa as rotas longas nas páginas públicas", () => {
    expect(buildLandingPagePathFor(SINGLE, "teste", "casa-na-praia")).toBe(
      "/lp/teste/casa-na-praia"
    )
    expect(buildLandingPageUrlFor(SINGLE, "teste", "casa-na-praia")).toBe(
      "https://plataforma.vercel.app/lp/teste/casa-na-praia"
    )
    expect(buildCapturePathFor(SINGLE, "teste")).toBe("/captar/teste")
    expect(buildCaptureUrlFor(SINGLE, "teste")).toBe("https://plataforma.vercel.app/captar/teste")
    expect(buildPortalFeedUrlFor(SINGLE, "teste", "abc123")).toBe(
      "https://plataforma.vercel.app/api/feeds/teste/vrsync.xml?token=abc123"
    )
    expect(buildInvitationUrlFor(SINGLE, "teste", "f00d")).toBe(
      "https://plataforma.vercel.app/convite/f00d"
    )
  })

  it("caminhos relativos funcionam sem origem; URLs absolutas exigem NEXT_PUBLIC_SITE_URL", () => {
    expect(buildCapturePathFor(SINGLE_NO_ORIGIN, "teste")).toBe("/captar/teste")
    expect(() => buildCaptureUrlFor(SINGLE_NO_ORIGIN, "teste")).toThrow(/NEXT_PUBLIC_SITE_URL/)
  })
})

describe("buildTenantLinkPreviewFor (prévia do link no cadastro)", () => {
  function fill(preview: ReturnType<typeof buildTenantLinkPreviewFor>, slug: string) {
    return preview ? `${preview.prefix}${slug}${preview.suffix}` : null
  }

  it("no modo subdomain mostra o endereço do CRM da imobiliária", () => {
    const preview = buildTenantLinkPreviewFor(PROD)
    expect(preview?.kind).toBe("crm")
    expect(preview?.suffix).toBe(".seucrm.com.br")
    expect(fill(preview, "teste")).toBe(buildTenantOriginFor(PROD, "teste"))
    expect(fill(buildTenantLinkPreviewFor(DEV), "teste")).toBe(buildTenantOriginFor(DEV, "teste"))
  })

  it("no host único mostra o link público da captação (o CRM não usa o slug)", () => {
    const preview = buildTenantLinkPreviewFor(SINGLE)
    expect(preview?.kind).toBe("public-pages")
    expect(fill(preview, "teste")).toBe(buildCaptureUrlFor(SINGLE, "teste"))
  })

  it("sem origem no host único não inventa link", () => {
    expect(buildTenantLinkPreviewFor(SINGLE_NO_ORIGIN)).toBeNull()
  })
})

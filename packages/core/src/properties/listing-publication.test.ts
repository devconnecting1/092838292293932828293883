import { describe, expect, it } from "vitest"

import { AUTHORIZATION_LIST_FILTERS, isAuthorizationListFilter } from "./authorization-alerts"
import {
  DEFAULT_LISTING_PUBLICATION_SETTINGS,
  evaluateListingPublication,
  hasValidAuthorization,
  isAuthorizationLapsed,
  normalizeGoogleTagId,
  normalizeMetaPixelId,
  resolvePublicPageEnabled,
  type ListingPublicationInput,
} from "./listing-publication"

const TODAY = "2026-09-17"

const VALID = { starts_on: "2026-01-01", ends_on: "2026-12-31" }
const EXPIRED = { starts_on: "2025-01-01", ends_on: "2026-09-16" }
const UPCOMING = { starts_on: "2026-09-18", ends_on: "2027-09-18" }
const OPEN_ENDED = { starts_on: "2026-01-01", ends_on: null }

function input(overrides: Partial<ListingPublicationInput> = {}): ListingPublicationInput {
  return {
    status: "active",
    isRestricted: false,
    publishedToPortals: true,
    publicPageEnabled: null,
    authorizations: [VALID],
    settings: DEFAULT_LISTING_PUBLICATION_SETTINGS,
    today: TODAY,
    ...overrides,
  }
}

describe("autorização vigente", () => {
  it("vigente no primeiro e no último dia, e sem prazo final", () => {
    expect(hasValidAuthorization([{ starts_on: TODAY, ends_on: TODAY }], TODAY)).toBe(true)
    expect(hasValidAuthorization([OPEN_ENDED], TODAY)).toBe(true)
    expect(hasValidAuthorization([EXPIRED], TODAY)).toBe(false)
  })

  it("vencida ou só futura é lapso; sem autorização cadastrada não é", () => {
    expect(isAuthorizationLapsed([EXPIRED], TODAY)).toBe(true)
    expect(isAuthorizationLapsed([UPCOMING], TODAY)).toBe(true)
    expect(isAuthorizationLapsed([EXPIRED, UPCOMING], TODAY)).toBe(true)
    expect(isAuthorizationLapsed([EXPIRED, VALID], TODAY)).toBe(false)
    expect(isAuthorizationLapsed([], TODAY)).toBe(false)
  })
})

describe("resolvePublicPageEnabled", () => {
  it("a chave do imóvel vence o padrão; sem escolha, vale o padrão", () => {
    expect(resolvePublicPageEnabled(false, true)).toBe(false)
    expect(resolvePublicPageEnabled(true, false)).toBe(true)
    expect(resolvePublicPageEnabled(null, false)).toBe(false)
    expect(resolvePublicPageEnabled(undefined, true)).toBe(true)
  })
})

describe("evaluateListingPublication", () => {
  it("imóvel ativo com autorização vigente está no ar nos dois canais", () => {
    const result = evaluateListingPublication(input())

    expect(result.publicPage).toEqual({
      enabled: true,
      followsDefault: true,
      online: true,
      reason: null,
    })
    expect(result.portals).toEqual({ online: true, reason: null })
    expect(result.blockedByAuthorization).toBe(false)
  })

  it("autorização vencida tira do ar a página e os portais; renovar traz de volta", () => {
    const vencida = evaluateListingPublication(input({ authorizations: [EXPIRED] }))

    expect(vencida.blockedByAuthorization).toBe(true)
    expect(vencida.publicPage.reason).toBe("authorization")
    expect(vencida.portals.reason).toBe("authorization")

    const renovada = evaluateListingPublication(
      input({ authorizations: [EXPIRED, { starts_on: TODAY, ends_on: "2027-09-17" }] })
    )

    expect(renovada.publicPage.online).toBe(true)
    expect(renovada.portals.online).toBe(true)
  })

  it("sem autorização cadastrada o anúncio continua no ar", () => {
    const result = evaluateListingPublication(input({ authorizations: [] }))

    expect(result.authorizationLapsed).toBe(false)
    expect(result.publicPage.online).toBe(true)
    expect(result.portals.online).toBe(true)
  })

  it("regra desligada na imobiliária mantém no ar, mas acusa o lapso", () => {
    const result = evaluateListingPublication(
      input({
        authorizations: [EXPIRED],
        settings: { ...DEFAULT_LISTING_PUBLICATION_SETTINGS, hideWithoutValidAuthorization: false },
      })
    )

    expect(result.authorizationLapsed).toBe(true)
    expect(result.blockedByAuthorization).toBe(false)
    expect(result.publicPage.online).toBe(true)
  })

  it("página desligada no imóvel sai só da página; portais seguem", () => {
    const result = evaluateListingPublication(input({ publicPageEnabled: false }))

    expect(result.publicPage).toMatchObject({
      enabled: false,
      followsDefault: false,
      online: false,
      reason: "public_page_disabled",
    })
    expect(result.portals.online).toBe(true)
  })

  it("padrão da imobiliária desligado vale para quem não escolheu", () => {
    const settings = { ...DEFAULT_LISTING_PUBLICATION_SETTINGS, publicPagesEnabledByDefault: false }

    expect(evaluateListingPublication(input({ settings })).publicPage.reason).toBe(
      "public_page_disabled"
    )
    expect(
      evaluateListingPublication(input({ settings, publicPageEnabled: true })).publicPage.online
    ).toBe(true)
  })

  it("restrito e inativo nunca vão ao ar, mesmo com a chave ligada", () => {
    const restrito = evaluateListingPublication(
      input({ isRestricted: true, publicPageEnabled: true, authorizations: [EXPIRED] })
    )

    expect(restrito.publicPage.reason).toBe("restricted")
    expect(restrito.portals.reason).toBe("restricted")
    expect(restrito.blockedByAuthorization).toBe(false)

    const inativo = evaluateListingPublication(input({ status: "reserved" }))

    expect(inativo.publicPage.reason).toBe("inactive")
    expect(inativo.portals.reason).toBe("inactive")
  })

  it("sem publicação nos portais o motivo é not_published", () => {
    const result = evaluateListingPublication(
      input({ publishedToPortals: false, authorizations: [EXPIRED] })
    )

    expect(result.portals.reason).toBe("not_published")
    expect(result.publicPage.reason).toBe("authorization")
  })
})

describe("IDs de medição", () => {
  it("Meta Pixel: só dígitos, 5 a 20", () => {
    expect(normalizeMetaPixelId(" 1234567890 ")).toBe("1234567890")
    expect(normalizeMetaPixelId("")).toBeNull()
    expect(normalizeMetaPixelId(null)).toBeNull()
    expect(normalizeMetaPixelId("1234")).toBeUndefined()
    expect(normalizeMetaPixelId("12a45")).toBeUndefined()
  })

  it("tag do Google: G-, GT- ou AW-, em maiúsculas; GTM recusado", () => {
    expect(normalizeGoogleTagId(" g-abc123 ")).toBe("G-ABC123")
    expect(normalizeGoogleTagId("AW-123")).toBe("AW-123")
    expect(normalizeGoogleTagId("")).toBeNull()
    expect(normalizeGoogleTagId("GTM-ABC123")).toBeUndefined()
    expect(normalizeGoogleTagId("G-<script>")).toBeUndefined()
  })
})

describe("filtro da lista", () => {
  it("sem = sem autorização vigente (not_valid)", () => {
    expect(isAuthorizationListFilter("sem")).toBe(true)
    expect(AUTHORIZATION_LIST_FILTERS.sem).toBe("not_valid")
  })
})

import { describe, expect, it } from "vitest"

import {
  defaultLeadViewForRequest,
  isMobileRequest,
  resolveLeadView,
  withLeadView,
} from "./initial-view"

const UA = {
  chromeAndroidPhone:
    "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36",
  chromeAndroidTablet:
    "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
  firefoxAndroidPhone: "Mozilla/5.0 (Android 14; Mobile; rv:142.0) Gecko/142.0 Firefox/142.0",
  firefoxAndroidTablet: "Mozilla/5.0 (Android 14; Tablet; rv:142.0) Gecko/142.0 Firefox/142.0",
  iPhone:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1",
  iPad: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Safari/605.1.15",
  desktopChrome:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
}

describe("isMobileRequest", () => {
  it("a dica de cliente decide sozinha quando vem", () => {
    expect(isMobileRequest({ secChUaMobile: "?1", userAgent: UA.desktopChrome })).toBe(true)
    expect(isMobileRequest({ secChUaMobile: " ?1 ", userAgent: null })).toBe(true)
    // "Versão para computador" no celular: a dica diz ?0 e vale o quadro.
    expect(isMobileRequest({ secChUaMobile: "?0", userAgent: UA.chromeAndroidPhone })).toBe(false)
  })

  it("sem a dica, reconhece telefones pelo User-Agent", () => {
    expect(isMobileRequest({ userAgent: UA.chromeAndroidPhone })).toBe(true)
    expect(isMobileRequest({ userAgent: UA.firefoxAndroidPhone })).toBe(true)
    expect(isMobileRequest({ userAgent: UA.iPhone })).toBe(true)
  })

  it("tablets e computadores ficam com o quadro", () => {
    expect(isMobileRequest({ userAgent: UA.chromeAndroidTablet })).toBe(false)
    expect(isMobileRequest({ userAgent: UA.firefoxAndroidTablet })).toBe(false)
    expect(isMobileRequest({ userAgent: UA.iPad })).toBe(false)
    expect(isMobileRequest({ userAgent: UA.desktopChrome })).toBe(false)
  })

  it("sem cabeçalho nenhum não é celular", () => {
    expect(isMobileRequest({})).toBe(false)
    expect(isMobileRequest({ secChUaMobile: "", userAgent: "" })).toBe(false)
    expect(isMobileRequest({ secChUaMobile: "talvez", userAgent: null })).toBe(false)
  })
})

describe("defaultLeadViewForRequest", () => {
  it("lista no celular e quadro no computador", () => {
    expect(defaultLeadViewForRequest({ secChUaMobile: "?1" })).toBe("lista")
    expect(defaultLeadViewForRequest({ userAgent: UA.iPhone })).toBe("lista")
    expect(defaultLeadViewForRequest({ secChUaMobile: "?0" })).toBe("quadro")
    expect(defaultLeadViewForRequest({ userAgent: UA.desktopChrome })).toBe("quadro")
  })
})

describe("resolveLeadView", () => {
  it("a visão do endereço vale sobre o padrão do aparelho", () => {
    expect(resolveLeadView("quadro", "lista")).toBe("quadro")
    expect(resolveLeadView("lista", "quadro")).toBe("lista")
    expect(resolveLeadView(["lista", "quadro"], "quadro")).toBe("lista")
  })

  it("sem visão (ou inválida) usa o padrão", () => {
    expect(resolveLeadView(undefined, "lista")).toBe("lista")
    expect(resolveLeadView(null, "quadro")).toBe("quadro")
    expect(resolveLeadView("", "lista")).toBe("lista")
    expect(resolveLeadView("tabela", "quadro")).toBe("quadro")
    expect(resolveLeadView([], "lista")).toBe("lista")
  })
})

describe("withLeadView", () => {
  it("acrescenta a visão ao endereço sem parâmetros", () => {
    expect(withLeadView("/leads", "quadro")).toBe("/leads?visao=quadro")
  })

  it("mantém os outros parâmetros e troca a visão que houver", () => {
    expect(withLeadView("/leads?origem=site&periodo=7d", "lista")).toBe(
      "/leads?origem=site&periodo=7d&visao=lista"
    )
    expect(withLeadView("/leads?visao=lista&origem=site", "quadro")).toBe(
      "/leads?visao=quadro&origem=site"
    )
  })
})

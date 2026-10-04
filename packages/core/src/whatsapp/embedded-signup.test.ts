import { describe, expect, it } from "vitest"

import { isMetaMessageOrigin, META_MESSAGE_ORIGINS } from "./embedded-signup"

describe("isMetaMessageOrigin", () => {
  it("aceita facebook.com e subdomínios em HTTPS", () => {
    expect(isMetaMessageOrigin("https://www.facebook.com")).toBe(true)
    expect(isMetaMessageOrigin("https://business.facebook.com")).toBe(true)
    expect(isMetaMessageOrigin("https://facebook.com")).toBe(true)
    expect(isMetaMessageOrigin("https://WWW.FACEBOOK.COM")).toBe(true)
  })

  it("recusa hosts que só terminam com o texto facebook.com", () => {
    expect(isMetaMessageOrigin("https://evilfacebook.com")).toBe(false)
    expect(isMetaMessageOrigin("https://facebook.com.example.com")).toBe(false)
    expect(isMetaMessageOrigin("https://www.facebook.com.evil.io")).toBe(false)
  })

  it("recusa sem HTTPS, com porta, credenciais ou valor inválido", () => {
    expect(isMetaMessageOrigin("http://www.facebook.com")).toBe(false)
    expect(isMetaMessageOrigin("https://www.facebook.com:8443")).toBe(false)
    expect(isMetaMessageOrigin("https://user:pass@www.facebook.com")).toBe(false)
    expect(isMetaMessageOrigin("null")).toBe(false)
    expect(isMetaMessageOrigin("")).toBe(false)
    expect(isMetaMessageOrigin(undefined)).toBe(false)
  })
})

describe("META_MESSAGE_ORIGINS", () => {
  it("só tem origens que a regra de subdomínio também aceita", () => {
    expect(META_MESSAGE_ORIGINS.every((origin) => isMetaMessageOrigin(origin))).toBe(true)
  })
})

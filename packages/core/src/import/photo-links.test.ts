import { describe, expect, it } from "vitest"

import {
  checkPhotoUrl,
  isPublicIpAddress,
  normalizePhotoUrl,
  parsePhotoLinks,
  sniffImageType,
} from "./photo-links"

describe("parsePhotoLinks", () => {
  it("separa por | e por quebra de linha, sem repetidos", () => {
    expect(
      parsePhotoLinks(
        "https://exemplo.com/1.jpg | https://exemplo.com/2.jpg\nhttps://exemplo.com/1.jpg"
      )
    ).toEqual({
      urls: ["https://exemplo.com/1.jpg", "https://exemplo.com/2.jpg"],
      invalid: 0,
      truncated: false,
    })
  })

  it("conta link inválido e corta acima do máximo", () => {
    expect(parsePhotoLinks("ftp://exemplo.com/a.jpg | foto.jpg").invalid).toBe(2)

    const many = Array.from({ length: 22 }, (_, index) => `https://exemplo.com/${index}.jpg`)
    const result = parsePhotoLinks(many.join(" | "))

    expect(result.urls).toHaveLength(20)
    expect(result.truncated).toBe(true)
  })

  it("vazio não traz nada", () => {
    expect(parsePhotoLinks("")).toEqual({ urls: [], invalid: 0, truncated: false })
  })
})

describe("normalizePhotoUrl", () => {
  it("recusa usuário e senha no link e espaço no meio", () => {
    expect(normalizePhotoUrl("https://user:senha@exemplo.com/a.jpg")).toBeNull()
    expect(normalizePhotoUrl("https://exemplo.com/a b.jpg")).toBeNull()
  })
})

describe("isPublicIpAddress", () => {
  it("aceita IP público", () => {
    expect(isPublicIpAddress("8.8.8.8")).toBe(true)
    expect(isPublicIpAddress("2606:4700:4700::1111")).toBe(true)
  })

  it("recusa endereços internos e reservados", () => {
    for (const address of [
      "127.0.0.1",
      "10.1.2.3",
      "172.16.0.1",
      "192.168.0.10",
      "169.254.169.254",
      "100.64.0.1",
      "0.0.0.0",
      "224.0.0.1",
      "255.255.255.255",
      "::1",
      "::",
      "fe80::1",
      "fd00::1",
      "::ffff:127.0.0.1",
      "::ffff:10.0.0.1",
      "64:ff9b::a9fe:a9fe",
      "2001:db8::1",
      "nao-e-ip",
    ]) {
      expect(isPublicIpAddress(address), address).toBe(false)
    }
  })
})

describe("checkPhotoUrl", () => {
  it("aceita site público em http(s) na porta padrão", () => {
    expect(checkPhotoUrl("https://cdn.exemplo.com.br/fotos/1.jpg").ok).toBe(true)
    expect(checkPhotoUrl("http://8.8.8.8/1.jpg").ok).toBe(true)
  })

  it("bloqueia localhost, IP interno (inclusive disfarçado), nome interno e porta estranha", () => {
    for (const link of [
      "http://localhost/a.jpg",
      "http://127.0.0.1/a.jpg",
      "http://2130706433/a.jpg",
      "http://0x7f.0.0.1/a.jpg",
      "http://[::1]/a.jpg",
      "http://169.254.169.254/latest/meta-data",
      "http://servidor/a.jpg",
      "http://nas.local/a.jpg",
      "https://exemplo.com:8443/a.jpg",
    ]) {
      expect(checkPhotoUrl(link), link).toEqual({ ok: false, code: "blocked_address" })
    }
  })

  it("link que não é http(s) é inválido", () => {
    expect(checkPhotoUrl("file:///etc/passwd")).toEqual({ ok: false, code: "invalid_link" })
    expect(checkPhotoUrl("javascript:alert(1)")).toEqual({ ok: false, code: "invalid_link" })
  })
})

describe("sniffImageType", () => {
  it("reconhece pelos primeiros bytes", () => {
    expect(sniffImageType(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg")
    expect(sniffImageType(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]))).toBe("image/png")
    expect(
      sniffImageType(
        new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50])
      )
    ).toBe("image/webp")
    expect(sniffImageType(new TextEncoder().encode("<html>"))).toBeNull()
  })
})

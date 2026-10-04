import { describe, expect, it } from "vitest"

import {
  cleanText,
  escapeHtml,
  isUuid,
  maskEmailAddress,
  maskPhoneNumber,
  normalizeEmailAddress,
  normalizeEmailOrigin,
  normalizeHexColor,
  readableTextColor,
  resolveEmailLink,
} from "./sanitize"

const LINE_SEPARATOR = String.fromCharCode(0x2028)
const PARAGRAPH_SEPARATOR = String.fromCharCode(0x2029)
const ORIGIN = "https://imob.seucrm.com.br"

describe("escapeHtml", () => {
  it("escapa tags, aspas, crase e separadores de linha Unicode", () => {
    expect(escapeHtml(`<script>alert('x' + "y")</script>`)).toBe(
      "&lt;script&gt;alert(&#39;x&#39; + &quot;y&quot;)&lt;/script&gt;"
    )
    expect(escapeHtml("a & b `c`")).toBe("a &amp; b &#96;c&#96;")
    expect(escapeHtml(`a${LINE_SEPARATOR}b${PARAGRAPH_SEPARATOR}c`)).toBe("a&#x2028;b&#x2029;c")
  })
})

describe("cleanText", () => {
  it("numa linha: troca quebras e U+2028 por espaço e junta espaços", () => {
    expect(cleanText(`  Ana\r\n${LINE_SEPARATOR}Maria\t\tSouza  `)).toBe("Ana Maria Souza")
  })

  it("remove controles e marcas invisíveis de direção", () => {
    expect(cleanText("abc\u0000\u0007\u202e\u2066def\u200b")).toBe("abcdef")
  })

  it("multilinha: mantém parágrafos e limita linhas em branco", () => {
    expect(cleanText(`um${PARAGRAPH_SEPARATOR}dois\n\n\n\ntrês`, { multiline: true })).toBe(
      "um\ndois\n\ntrês"
    )
  })

  it("corta sem quebrar emoji e ignora tipos inesperados", () => {
    expect(cleanText("😀😀😀😀", { maxLength: 3 })).toBe("😀😀…")
    expect(cleanText({ toString: () => "<b>" })).toBe("")
    expect(cleanText(null)).toBe("")
  })
})

describe("resolveEmailLink", () => {
  it("resolve caminhos relativos contra a origem", () => {
    expect(resolveEmailLink("/leads/abc", ORIGIN)).toBe(`${ORIGIN}/leads/abc`)
    expect(resolveEmailLink("https://outro.example/convite/1", ORIGIN)).toBe(
      "https://outro.example/convite/1"
    )
  })

  it("rejeita javascript:, data:, protocolo relativo, credenciais e caracteres suspeitos", () => {
    for (const href of [
      "javascript:alert(1)",
      "JAVASCRIPT:alert(1)",
      "\tjavascript:alert(1)",
      "java\u0000script:alert(1)",
      "data:text/html;base64,PHNjcmlwdD4=",
      "vbscript:msgbox",
      "//evil.example",
      "/\\evil.example",
      "\\\\evil.example",
      "http://evil.example",
      "https://user:pass@evil.example",
      `/leads${LINE_SEPARATOR}x`,
      "leads/1",
      "",
    ]) {
      expect(resolveEmailLink(href, ORIGIN), href).toBeNull()
    }
  })

  it("origem precisa ser https (ou http em localhost)", () => {
    expect(normalizeEmailOrigin("https://imob.seucrm.com.br/qualquer")).toBe(ORIGIN)
    expect(normalizeEmailOrigin("http://localhost:3000")).toBe("http://localhost:3000")
    expect(normalizeEmailOrigin("http://imob.example")).toBeNull()
    expect(resolveEmailLink("/leads", "ftp://imob.example")).toBeNull()
  })
})

describe("cores", () => {
  it("normaliza hexadecimal e escolhe texto legível", () => {
    expect(normalizeHexColor("#0c6b63")).toBe("#0C6B63")
    expect(normalizeHexColor("#abc")).toBe("#AABBCC")
    expect(normalizeHexColor("#12345678")).toBeNull()
    expect(normalizeHexColor("red")).toBeNull()
    expect(readableTextColor("#0C6B63")).toBe("#FFFFFF")
    expect(readableTextColor("#FFEB3B")).toBe("#111111")
  })
})

describe("dados pessoais", () => {
  it("mascara telefone deixando DDD e 4 últimos dígitos", () => {
    expect(maskPhoneNumber("11987654321")).toBe("(11) *****-4321")
    expect(maskPhoneNumber("1133334444")).toBe("(11) ****-4444")
    expect(maskPhoneNumber("5511987654321")).toBe("(11) *****-4321")
    expect(maskPhoneNumber("123")).toBeNull()
  })

  it("valida e mascara e-mail para logs", () => {
    expect(normalizeEmailAddress("  Maria.Silva@Exemplo.com ")).toBe("maria.silva@exemplo.com")
    expect(normalizeEmailAddress("a..b@exemplo.com")).toBeNull()
    expect(normalizeEmailAddress("maria@exemplo.com\nBcc: x@y.com")).toBeNull()
    expect(normalizeEmailAddress('"maria"@exemplo.com')).toBeNull()
    expect(maskEmailAddress("maria.silva@exemplo.com")).toBe("ma***@exemplo.com")
    expect(maskEmailAddress("invalido")).toBe("***")
  })

  it("reconhece uuid", () => {
    expect(isUuid("3f0c1a2b-4d5e-4f60-8a7b-9c0d1e2f3a4b")).toBe(true)
    expect(isUuid("3f0c1a2b")).toBe(false)
  })
})

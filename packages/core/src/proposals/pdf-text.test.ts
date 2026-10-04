import { describe, expect, it } from "vitest"

import {
  supportedByAll,
  toPdfText,
  wrapText,
  type MeasureText,
  type SupportsCodePoint,
} from "./pdf-text"

/** Medição de mentira: 1 caractere = 1 unidade (como uma fonte monoespaçada). */
const measure: MeasureText = (text) => text.length

const codePoints = (text: string) => [...text].map((character) => character.codePointAt(0) ?? -1)

/**
 * Parecida com a Geist: desenha latim, pontuação, setas e formas até U+25FF, mas
 * não tem emoji, ⇒, ✓, ✔, ▪ nem os espaços finos.
 */
const GEIST_MISSING = new Set(codePoints("⇒✓✔▪\u202f\u2009\u2007"))
const geistLike: SupportsCodePoint = (codePoint) =>
  codePoint <= 0x25ff && !GEIST_MISSING.has(codePoint)

/** Parecida com a Helvetica padrão (WinAnsi): ASCII, Latin-1 e alguns avulsos. */
const winAnsiLike = supportedByAll([
  ...Array.from({ length: 0x7f - 0x20 }, (_, index) => 0x20 + index),
  ...Array.from({ length: 0x100 - 0xa0 }, (_, index) => 0xa0 + index),
  ...codePoints("–—‘’“”•…€"),
])

describe("toPdfText", () => {
  it("mantém o pt-BR inteiro", () => {
    const text =
      "Proposta de aquisição — R$ 1.250.000,00 (Cond. Jardim São João, 3º andar, 2ª vaga)"
    expect(toPdfText(text, geistLike)).toBe(text)
    expect(toPdfText(text, winAnsiLike)).toBe(text)
  })

  it("mantém acentos, cedilha e til", () => {
    expect(toPdfText("áéíóúàâêôãõçÁÉÍÓÚÃÕÇ", geistLike)).toBe("áéíóúàâêôãõçÁÉÍÓÚÃÕÇ")
  })

  it("junta acento combinado no caractere único", () => {
    expect(toPdfText("Franc\u0327a", geistLike)).toBe("França")
  })

  it("mantém o símbolo que a fonte desenha", () => {
    expect(toPdfText("entrada ≥ 30% → escritura", geistLike)).toBe("entrada ≥ 30% → escritura")
  })

  it("troca o que a fonte não desenha e descarta o resto", () => {
    expect(toPdfText("sinal ⇒ escritura", geistLike)).toBe("sinal => escritura")
    expect(toPdfText("✓ documentação", geistLike)).toBe("- documentação")
    expect(toPdfText("tudo certo ✅", geistLike)).toBe("tudo certo ")
    expect(toPdfText("ótimo 👍🏽", geistLike)).toBe("ótimo ")
  })

  it("com a fonte de reserva (WinAnsi), troca setas, comparações e menos", () => {
    expect(toPdfText("entrada ≥ 30% → escritura", winAnsiLike)).toBe("entrada >= 30% -> escritura")
    expect(toPdfText("10 \u2212 2", winAnsiLike)).toBe("10 - 2")
    expect(toPdfText("Nguyễn", winAnsiLike)).toBe("Nguyen")
  })

  it("remove controle e invisíveis; tabulação e espaço fino viram espaço", () => {
    expect(toPdfText("a\u0000b\u200bc\u00add\ufeffe\u0007", geistLike)).toBe("abcde")
    expect(toPdfText("valor:\t10\u202f000", geistLike)).toBe("valor: 10 000")
    expect(toPdfText("R$\u00a010", geistLike)).toBe("R$\u00a010")
  })

  it("padroniza quebras de linha e trata vazio", () => {
    expect(toPdfText("uma\r\nduas\rtrês\u2028quatro", geistLike)).toBe("uma\nduas\ntrês\nquatro")
    expect(toPdfText(null, geistLike)).toBe("")
    expect(toPdfText(undefined, geistLike)).toBe("")
    expect(toPdfText("", geistLike)).toBe("")
  })
})

describe("supportedByAll", () => {
  it("aceita só o que todas as fontes desenham", () => {
    const supports = supportedByAll(codePoints("abc"), codePoints("bcd"))
    expect(codePoints("abcd").map(supports)).toEqual([false, true, true, false])
  })
})

describe("wrapText", () => {
  it("quebra por palavras dentro da largura", () => {
    expect(wrapText("uma duas tres quatro", 9, measure)).toEqual(["uma duas", "tres", "quatro"])
  })

  it("respeita as quebras digitadas, inclusive linha em branco", () => {
    expect(wrapText("primeira\n\nsegunda", 20, measure)).toEqual(["primeira", "", "segunda"])
  })

  it("parte palavra maior que a linha", () => {
    expect(wrapText("abcdefghij", 4, measure)).toEqual(["abcd", "efgh", "ij"])
  })

  it("parte a palavra longa depois de fechar a linha anterior", () => {
    expect(wrapText("ok abcdefghij", 4, measure)).toEqual(["ok", "abcd", "efgh", "ij"])
  })

  it("devolve vazio para largura inútil", () => {
    expect(wrapText("qualquer coisa", 0, measure)).toEqual([])
  })
})

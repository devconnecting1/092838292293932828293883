import { describe, expect, it } from "vitest"

import { detectFileKind, isAnimatedGif, isDecodableImageKind, sniffFileKind } from "./image-type"

const bytes = (...parts: (number[] | string)[]) =>
  new Uint8Array(
    parts.flatMap((part) =>
      typeof part === "string" ? Array.from(part, (char) => char.charCodeAt(0)) : part
    )
  )

/** GIF mínimo com `frames` quadros (1×1 px, paleta global de 2 cores). */
function gif(frames: number, { netscapeLoop = false } = {}) {
  const header = bytes("GIF89a", [1, 0, 1, 0, 0x80, 0, 0], [0, 0, 0, 255, 255, 255])
  const loop = netscapeLoop
    ? bytes([0x21, 0xff, 0x0b], "NETSCAPE2.0", [0x03, 0x01, 0x00, 0x00, 0x00])
    : bytes()
  const frame = bytes(
    [0x21, 0xf9, 0x04, 0x00, 0x0a, 0x00, 0x00, 0x00],
    [0x2c, 0, 0, 0, 0, 1, 0, 1, 0, 0x00],
    [0x02, 0x02, 0x44, 0x01, 0x00]
  )
  return bytes(
    Array.from(header),
    Array.from(loop),
    ...Array.from({ length: frames }, () => Array.from(frame)),
    [0x3b]
  )
}

describe("detectFileKind", () => {
  it("usa o MIME quando conhecido", () => {
    expect(detectFileKind({ type: "image/jpeg", name: "x.png" })).toBe("jpeg")
    expect(detectFileKind({ type: "image/heif", name: "IMG_0001.HEIC" })).toBe("heic")
    expect(detectFileKind({ type: "image/svg+xml", name: "logo.svg" })).toBe("svg")
    expect(detectFileKind({ type: "application/pdf", name: "rg.pdf" })).toBe("pdf")
  })

  it("cai para a extensão sem MIME (Windows e .heic)", () => {
    expect(detectFileKind({ type: "", name: "IMG_0001.HEIC" })).toBe("heic")
    expect(detectFileKind({ type: "application/octet-stream", name: "casa.JPEG" })).toBe("jpeg")
    expect(detectFileKind({ type: "", name: "planilha.xlsx" })).toBe("unknown")
    expect(detectFileKind({ type: "", name: "sem-extensao" })).toBe("unknown")
  })
})

describe("sniffFileKind", () => {
  it("reconhece as assinaturas", () => {
    expect(sniffFileKind(bytes([0xff, 0xd8, 0xff, 0xe0]))).toBe("jpeg")
    expect(sniffFileKind(bytes([0x89], "PNG", [0x0d, 0x0a, 0x1a, 0x0a]))).toBe("png")
    expect(sniffFileKind(bytes("RIFF", [0x24, 0, 0, 0], "WEBPVP8 "))).toBe("webp")
    expect(sniffFileKind(bytes([0, 0, 0, 0x18], "ftypheic", [0, 0, 0, 0]))).toBe("heic")
    expect(sniffFileKind(bytes([0, 0, 0, 0x1c], "ftypmif1", [0, 0, 0, 0]))).toBe("heic")
    expect(sniffFileKind(bytes("%PDF-1.7"))).toBe("pdf")
    expect(sniffFileKind(gif(1))).toBe("gif")
  })

  it("detecta SVG disfarçado", () => {
    expect(
      sniffFileKind(bytes('<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg">'))
    ).toBe("svg")
    expect(sniffFileKind(bytes("  <svg viewBox='0 0 1 1'>"))).toBe("svg")
  })

  it("não reconhece conteúdo arbitrário", () => {
    expect(sniffFileKind(bytes("olá, mundo"))).toBe("unknown")
    expect(sniffFileKind(bytes())).toBe("unknown")
  })
})

describe("isAnimatedGif", () => {
  it("GIF de um quadro não é animado", () => {
    expect(isAnimatedGif(gif(1))).toBe(false)
  })

  it("GIF com dois ou mais quadros é animado", () => {
    expect(isAnimatedGif(gif(2))).toBe(true)
    expect(isAnimatedGif(gif(3, { netscapeLoop: true }))).toBe(true)
  })

  it("não quebra com arquivo truncado ou que não é GIF", () => {
    expect(isAnimatedGif(gif(2).slice(0, 30))).toBe(false)
    expect(isAnimatedGif(bytes([0xff, 0xd8, 0xff]))).toBe(false)
  })
})

describe("isDecodableImageKind", () => {
  it("aceita fotos e recusa SVG, PDF e desconhecidos", () => {
    expect(isDecodableImageKind("heic")).toBe(true)
    expect(isDecodableImageKind("gif")).toBe(true)
    expect(isDecodableImageKind("svg")).toBe(false)
    expect(isDecodableImageKind("pdf")).toBe(false)
    expect(isDecodableImageKind("unknown")).toBe(false)
  })
})

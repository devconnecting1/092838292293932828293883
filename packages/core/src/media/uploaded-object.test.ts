import { describe, expect, it } from "vitest"

import {
  checkUploadedObject,
  expectedContentTypeForPath,
  extensionOfPath,
  normalizeContentType,
  uploadedObjectProblemMessage,
} from "./uploaded-object"

const MB = 1024 * 1024
const PHOTO_RULES = { allowedTypes: ["image/jpeg", "image/webp"], maxBytes: 2 * MB }

describe("normalizeContentType", () => {
  it("tira parâmetros, espaços e maiúsculas", () => {
    expect(normalizeContentType("Image/JPEG; charset=binary")).toBe("image/jpeg")
    expect(normalizeContentType("  application/pdf ")).toBe("application/pdf")
  })

  it("devolve vazio sem tipo", () => {
    expect(normalizeContentType(null)).toBe("")
    expect(normalizeContentType(undefined)).toBe("")
    expect(normalizeContentType("")).toBe("")
  })
})

describe("extensionOfPath / expectedContentTypeForPath", () => {
  it("lê a extensão só do nome do arquivo", () => {
    expect(extensionOfPath("org/properties/imovel/abc.JPG")).toBe("jpg")
    expect(extensionOfPath("org/pasta.v2/arquivo")).toBe("")
    expect(extensionOfPath("org/x/.oculto")).toBe("")
  })

  it("mapeia as extensões usadas nos buckets", () => {
    expect(expectedContentTypeForPath("a/b/c.jpg")).toBe("image/jpeg")
    expect(expectedContentTypeForPath("a/b/c.jpeg")).toBe("image/jpeg")
    expect(expectedContentTypeForPath("a/b/c.png")).toBe("image/png")
    expect(expectedContentTypeForPath("a/b/c__thumb.webp")).toBe("image/webp")
    expect(expectedContentTypeForPath("a/b/c.pdf")).toBe("application/pdf")
    expect(expectedContentTypeForPath("a/b/c.svg")).toBeNull()
  })
})

describe("checkUploadedObject", () => {
  it("aceita o arquivo dentro das regras e devolve o tamanho real", () => {
    expect(
      checkUploadedObject(
        { size: 240_000, contentType: "image/jpeg" },
        {
          ...PHOTO_RULES,
          expectedType: "image/jpeg",
        }
      )
    ).toEqual({ ok: true, size: 240_000, contentType: "image/jpeg" })
  })

  it("recusa arquivo ausente ou vazio", () => {
    expect(checkUploadedObject(null, PHOTO_RULES)).toEqual({ ok: false, problem: "missing" })
    expect(checkUploadedObject({ size: 0, contentType: "image/jpeg" }, PHOTO_RULES)).toEqual({
      ok: false,
      problem: "empty",
    })
    expect(checkUploadedObject({ contentType: "image/jpeg" }, PHOTO_RULES)).toEqual({
      ok: false,
      problem: "empty",
    })
  })

  it("recusa acima do limite (o limite exato passa)", () => {
    expect(checkUploadedObject({ size: 2 * MB, contentType: "image/webp" }, PHOTO_RULES).ok).toBe(
      true
    )
    expect(
      checkUploadedObject({ size: 2 * MB + 1, contentType: "image/webp" }, PHOTO_RULES)
    ).toEqual({ ok: false, problem: "too_large" })
  })

  it("recusa tipo fora da lista ou sem tipo", () => {
    expect(checkUploadedObject({ size: 10, contentType: "image/png" }, PHOTO_RULES)).toEqual({
      ok: false,
      problem: "type_not_allowed",
    })
    expect(checkUploadedObject({ size: 10, contentType: null }, PHOTO_RULES)).toEqual({
      ok: false,
      problem: "type_not_allowed",
    })
  })

  it("recusa tipo diferente do esperado (PDF declarado, imagem gravada)", () => {
    const rules = {
      allowedTypes: ["application/pdf", "image/jpeg"],
      maxBytes: 10 * MB,
      expectedType: "application/pdf",
    }
    expect(checkUploadedObject({ size: 10, contentType: "image/jpeg" }, rules)).toEqual({
      ok: false,
      problem: "type_mismatch",
    })
    expect(
      checkUploadedObject({ size: 10, contentType: "image/jpeg" }, { ...rules, expectedType: null })
    ).toEqual({ ok: false, problem: "type_mismatch" })
  })
})

describe("uploadedObjectProblemMessage", () => {
  it("explica cada problema em pt-BR", () => {
    const options = { formats: "JPG ou WebP", maxBytes: 2 * MB }
    expect(uploadedObjectProblemMessage("too_large", options)).toBe("O arquivo passa de 2 MB.")
    expect(uploadedObjectProblemMessage("type_mismatch", options)).toBe(
      "Formato não aceito. Envie JPG ou WebP."
    )
    expect(uploadedObjectProblemMessage("missing", options)).toContain("não chegou")
  })
})

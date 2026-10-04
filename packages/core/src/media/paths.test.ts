import { describe, expect, it } from "vitest"

import {
  THUMB_SUFFIX,
  buildPhotoSrcSet,
  getThumbUrl,
  isThumbPath,
  replaceExtension,
  thumbPathFor,
} from "./paths"

const PHOTO = "0b9f/properties/7c1e/5f0c8d5e-3a4b-4c1d-9e2f-1a2b3c4d5e6f.jpg"
const PUBLIC_URL = `https://abc.supabase.co/storage/v1/object/public/property-media/${PHOTO}`

describe("thumbPathFor", () => {
  it("troca a extensão pelo sufixo da miniatura, na mesma pasta", () => {
    expect(thumbPathFor(PHOTO)).toBe(
      "0b9f/properties/7c1e/5f0c8d5e-3a4b-4c1d-9e2f-1a2b3c4d5e6f__thumb.webp"
    )
    expect(thumbPathFor("org/properties/p/antiga.png")).toBe("org/properties/p/antiga__thumb.webp")
  })

  it("é idempotente e só olha o nome do arquivo", () => {
    const thumb = thumbPathFor(PHOTO)
    expect(thumbPathFor(thumb)).toBe(thumb)
    expect(thumbPathFor("pasta.v2/arquivo")).toBe("pasta.v2/arquivo__thumb.webp")
    expect(thumbPathFor("foto")).toBe("foto__thumb.webp")
  })

  it("recusa caminho sem nome de arquivo", () => {
    expect(() => thumbPathFor("org/properties/")).toThrow()
    expect(() => thumbPathFor("")).toThrow()
  })

  it("identifica caminhos de miniatura", () => {
    expect(isThumbPath(thumbPathFor(PHOTO))).toBe(true)
    expect(isThumbPath(PHOTO)).toBe(false)
    expect(THUMB_SUFFIX).toBe("__thumb.webp")
  })
})

describe("getThumbUrl", () => {
  it("deriva a URL pública da miniatura", () => {
    expect(getThumbUrl(PUBLIC_URL)).toBe(
      "https://abc.supabase.co/storage/v1/object/public/property-media/0b9f/properties/7c1e/5f0c8d5e-3a4b-4c1d-9e2f-1a2b3c4d5e6f__thumb.webp"
    )
  })

  it("preserva query string e fragmento", () => {
    expect(getThumbUrl(`${PUBLIC_URL}?v=2#x`)).toMatch(/__thumb\.webp\?v=2#x$/)
  })

  it("devolve null sem URL ou sem arquivo", () => {
    expect(getThumbUrl(null)).toBeNull()
    expect(getThumbUrl(undefined)).toBeNull()
    expect(getThumbUrl("")).toBeNull()
    expect(getThumbUrl("https://abc.supabase.co/")).toBeNull()
  })
})

describe("buildPhotoSrcSet", () => {
  it("lista a miniatura (400w) e a principal (1600w)", () => {
    expect(buildPhotoSrcSet(PUBLIC_URL)).toBe(
      `${getThumbUrl(PUBLIC_URL)} 400w, ${PUBLIC_URL} 1600w`
    )
    expect(buildPhotoSrcSet(null)).toBeUndefined()
  })
})

describe("replaceExtension", () => {
  it("troca ou acrescenta a extensão", () => {
    expect(replaceExtension("RG frente.png", "jpg")).toBe("RG frente.jpg")
    expect(replaceExtension("IMG_0001.HEIC", ".jpg")).toBe("IMG_0001.jpg")
    expect(replaceExtension("comprovante.2026.webp", "jpg")).toBe("comprovante.2026.jpg")
    expect(replaceExtension("arquivo", "jpg")).toBe("arquivo.jpg")
  })
})

import { describe, expect, it } from "vitest"

import { MAX_PROPERTY_PHOTOS, splitByPhotoLimit } from "./limits"

describe("splitByPhotoLimit", () => {
  it("aceita só o que cabe no limite de 10 fotos", () => {
    expect(MAX_PROPERTY_PHOTOS).toBe(10)
    expect(splitByPhotoLimit(8, 5)).toEqual({ remaining: 2, accepted: 2, rejected: 3 })
    expect(splitByPhotoLimit(0, 3)).toEqual({ remaining: 10, accepted: 3, rejected: 0 })
  })

  it("bloqueia tudo quando o imóvel já está no limite (ou acima)", () => {
    expect(splitByPhotoLimit(10, 1)).toEqual({ remaining: 0, accepted: 0, rejected: 1 })
    expect(splitByPhotoLimit(25, 2)).toEqual({ remaining: 0, accepted: 0, rejected: 2 })
  })

  it("aceita outro limite", () => {
    expect(splitByPhotoLimit(3, 4, 5)).toEqual({ remaining: 2, accepted: 2, rejected: 2 })
  })
})

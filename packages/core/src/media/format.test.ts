import { describe, expect, it } from "vitest"

import { formatBytes, formatSizeChange } from "./format"

describe("formatBytes", () => {
  it("formata em pt-BR com a unidade adequada", () => {
    expect(formatBytes(0)).toBe("0 B")
    expect(formatBytes(512)).toBe("512 B")
    expect(formatBytes(1536)).toBe("1,5 KB")
    expect(formatBytes(240 * 1024)).toBe("240 KB")
    expect(formatBytes(2.8 * 1024 * 1024)).toBe("2,8 MB")
    expect(formatBytes(7 * 1024 * 1024)).toBe("7 MB")
  })

  it("trata valores inválidos como zero", () => {
    expect(formatBytes(-10)).toBe("0 B")
    expect(formatBytes(Number.NaN)).toBe("0 B")
  })
})

describe("formatSizeChange", () => {
  it("mostra o antes e o depois", () => {
    expect(formatSizeChange(2.8 * 1024 * 1024, 240 * 1024)).toBe("2,8 MB → 240 KB")
  })
})

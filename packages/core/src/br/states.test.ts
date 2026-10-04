import { describe, expect, it } from "vitest"
import { BRAZILIAN_STATES, isStateCode } from "./states"

describe("BRAZILIAN_STATES", () => {
  it("contém as 27 unidades federativas", () => {
    expect(BRAZILIAN_STATES).toHaveLength(27)
  })

  it("não tem códigos duplicados", () => {
    const codes = BRAZILIAN_STATES.map((state) => state.code)
    expect(new Set(codes).size).toBe(27)
  })

  it("inclui São Paulo com o rótulo correto", () => {
    expect(BRAZILIAN_STATES).toContainEqual({ code: "SP", name: "São Paulo" })
  })
})

describe("isStateCode", () => {
  it("reconhece códigos válidos", () => {
    expect(isStateCode("SP")).toBe(true)
    expect(isStateCode("DF")).toBe(true)
  })

  it("rejeita códigos inválidos", () => {
    expect(isStateCode("XX")).toBe(false)
    expect(isStateCode("sp")).toBe(false)
  })
})

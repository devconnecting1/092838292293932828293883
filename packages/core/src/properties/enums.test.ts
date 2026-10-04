import { describe, expect, it } from "vitest"
import {
  PROPERTY_TYPE_LABELS,
  PROPERTY_TYPE_VALUES,
  requiredPrices,
  requiresLotArea,
} from "./enums"

describe("PROPERTY_TYPE_VALUES", () => {
  it("tem exatamente os 15 valores esperados, na ordem do enunciado", () => {
    expect(PROPERTY_TYPE_VALUES).toEqual([
      "apartment",
      "house",
      "condo_house",
      "penthouse",
      "studio",
      "flat",
      "land",
      "commercial_room",
      "office",
      "store",
      "warehouse",
      "building",
      "farm",
      "ranch",
      "other",
    ])
  })

  it("tem um rótulo pt-BR para cada valor", () => {
    for (const value of PROPERTY_TYPE_VALUES) {
      expect(PROPERTY_TYPE_LABELS[value]).toBeTruthy()
    }
    expect(PROPERTY_TYPE_LABELS.studio).toBe("Studio/Kitnet")
    expect(PROPERTY_TYPE_LABELS.condo_house).toBe("Casa em condomínio")
  })
})

describe("requiresLotArea", () => {
  it("retorna true apenas para land, farm, ranch e warehouse", () => {
    expect(requiresLotArea("land")).toBe(true)
    expect(requiresLotArea("farm")).toBe(true)
    expect(requiresLotArea("ranch")).toBe(true)
    expect(requiresLotArea("warehouse")).toBe(true)
    expect(requiresLotArea("apartment")).toBe(false)
    expect(requiresLotArea("house")).toBe(false)
  })
})

describe("requiredPrices", () => {
  it("exige salePrice para venda", () => {
    expect(requiredPrices("sale")).toEqual(["salePrice"])
  })

  it("exige rentPrice para locação", () => {
    expect(requiredPrices("rent")).toEqual(["rentPrice"])
  })

  it("exige ambos para venda e locação", () => {
    expect(requiredPrices("sale_rent")).toEqual(["salePrice", "rentPrice"])
  })
})

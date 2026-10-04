import { describe, expect, it } from "vitest"

import {
  LIMIT_KEYS,
  LIMITS,
  computeLimits,
  isAtLimit,
  isNearLimit,
  isOverLimit,
  isUnlimited,
  usageRatio,
} from "./limits"
import { PLANS } from "./plans"

describe("LIMITS", () => {
  it("descreve todas as chaves e diz quais o banco aplica", () => {
    expect(Object.keys(LIMITS)).toEqual([...LIMIT_KEYS])
    const enforced = LIMIT_KEYS.filter((key) => LIMITS[key].enforced)
    expect(enforced).toEqual(["users", "landing_pages", "owned_listings", "photos_per_listing"])
  })
})

describe("computeLimits", () => {
  it("soma os extras aos usuários incluídos", () => {
    expect(computeLimits("imobiliaria", 2)).toEqual({ ...PLANS.imobiliaria.limits, users: 5 })
    expect(computeLimits("rede", 100).users).toBe(110)
    expect(computeLimits("equipe", 0)).toEqual(PLANS.equipe.limits)
  })

  it("capa os usuários pelo usersMax", () => {
    expect(computeLimits("corretor", 1).users).toBe(2)
    expect(computeLimits("corretor", 5).users).toBe(2)
  })

  it("ignora extras inválidos", () => {
    expect(computeLimits("equipe", -2).users).toBe(5)
    expect(computeLimits("equipe", Number.NaN).users).toBe(5)
    expect(computeLimits("equipe", 1.8).users).toBe(6)
  })

  it("soma os pacotes de +10 imóveis ao limite de imóveis com foto", () => {
    expect(computeLimits("corretor", 0, 1).owned_listings).toBe(15)
    expect(computeLimits("imobiliaria", 2, 3)).toEqual({
      ...PLANS.imobiliaria.limits,
      users: 5,
      owned_listings: 50,
    })
    expect(computeLimits("rede", 0, 0).owned_listings).toBe(150)
    expect(computeLimits("equipe", 0, -2).owned_listings).toBe(50)
    expect(computeLimits("equipe", 0, 1.9).owned_listings).toBe(60)
    // Fotos por imóvel não mudam com o pacote.
    expect(computeLimits("equipe", 0, 5).photos_per_listing).toBe(10)
  })

  it("não altera o catálogo", () => {
    computeLimits("imobiliaria", 10)
    expect(PLANS.imobiliaria.limits.users).toBe(3)
  })
})

describe("isOverLimit e isAtLimit", () => {
  it("nunca estoura limite ilimitado", () => {
    expect(isUnlimited(-1)).toBe(true)
    expect(isOverLimit(-1, 1_000_000)).toBe(false)
    expect(isAtLimit(-1, 1_000_000)).toBe(false)
  })

  it("compara o uso com o limite", () => {
    expect(isOverLimit(3, 2)).toBe(false)
    expect(isOverLimit(3, 3)).toBe(false)
    expect(isOverLimit(3, 4)).toBe(true)
    expect(isAtLimit(3, 2)).toBe(false)
    expect(isAtLimit(3, 3)).toBe(true)
    expect(isAtLimit(3, 4)).toBe(true)
  })

  it("trata limite 0 como não incluso", () => {
    expect(isOverLimit(0, 0)).toBe(false)
    expect(isOverLimit(0, 1)).toBe(true)
    expect(isAtLimit(0, 0)).toBe(true)
  })
})

describe("usageRatio e isNearLimit", () => {
  it("devolve null para ilimitado", () => {
    expect(usageRatio(-1, 10)).toBeNull()
    expect(isNearLimit(-1, 10)).toBe(false)
  })

  it("calcula a fração, inclusive acima de 1", () => {
    expect(usageRatio(10, 8)).toBe(0.8)
    expect(usageRatio(3, 0)).toBe(0)
    expect(usageRatio(10, 12)).toBe(1.2)
    expect(usageRatio(10, -3)).toBe(0)
  })

  it("trata limite 0", () => {
    expect(usageRatio(0, 0)).toBe(0)
    expect(usageRatio(0, 2)).toBe(Number.POSITIVE_INFINITY)
  })

  it("sugere upgrade a partir de 80%", () => {
    expect(isNearLimit(10, 7)).toBe(false)
    expect(isNearLimit(10, 8)).toBe(true)
    expect(isNearLimit(15, 15)).toBe(true)
    expect(isNearLimit(0, 0)).toBe(false)
  })
})

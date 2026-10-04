import { describe, expect, it } from "vitest"

import { diffCatalogPrice, formatCatalogPriceDivergenceWarning } from "./catalog"

describe("diffCatalogPrice", () => {
  it("devolve null quando os centavos batem", () => {
    expect(diffCatalogPrice("plan_equipe_monthly", 77500, 77500)).toBeNull()
    expect(diffCatalogPrice("seat_rede_yearly", 79000, 79000)).toBeNull()
  })

  it("devolve a divergência com plano, intervalo e os dois valores", () => {
    expect(diffCatalogPrice("plan_equipe_monthly", 77500, 79900)).toEqual({
      lookupKey: "plan_equipe_monthly",
      kind: "plan",
      planKey: "equipe",
      interval: "month",
      corePriceCents: 77500,
      stripePriceCents: 79900,
    })

    expect(diffCatalogPrice("seat_corretor_yearly", 49000, 39000)).toEqual({
      lookupKey: "seat_corretor_yearly",
      kind: "seat",
      planKey: "corretor",
      interval: "year",
      corePriceCents: 49000,
      stripePriceCents: 39000,
    })
  })

  it("ignora lookup_key fora do padrão plan_*/seat_* (ex.: add-on)", () => {
    expect(diffCatalogPrice("addon_launches_monthly", 19000, 25000)).toBeNull()
    expect(diffCatalogPrice("", 100, 200)).toBeNull()
  })

  it("não confunde 0 com ausência de divergência quando os valores realmente diferem", () => {
    expect(diffCatalogPrice("plan_corretor_monthly", 0, 11500)).toEqual(
      expect.objectContaining({ corePriceCents: 0, stripePriceCents: 11500 })
    )
  })
})

describe("formatCatalogPriceDivergenceWarning", () => {
  it("cita plano, intervalo e os dois valores em centavos, sem chave nem dado de cliente", () => {
    const divergence = diffCatalogPrice("plan_imobiliaria_yearly", 320000, 329000)
    expect(divergence).not.toBeNull()

    const message = formatCatalogPriceDivergenceWarning(divergence!)

    expect(message).toContain("plan_imobiliaria_yearly")
    expect(message).toContain("imobiliaria")
    expect(message).toContain("year")
    expect(message).toContain("core=320000")
    expect(message).toContain("stripe=329000")
    // Nada de e-mail, id de cliente/organização ou chave secreta no aviso.
    expect(message).not.toMatch(/@|cus_|org_|sk_|rk_|whsec_/)
  })
})

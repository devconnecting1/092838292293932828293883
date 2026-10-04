import { describe, expect, it } from "vitest"

import { pickOfficialCityName } from "./city"

describe("pickOfficialCityName", () => {
  it("usa a grafia com acento do CEP quando é o mesmo município da Receita", () => {
    expect(pickOfficialCityName("Brasilia", "Brasília")).toBe("Brasília")
    expect(pickOfficialCityName("Sao Jose dos Campos", "São José dos Campos")).toBe(
      "São José dos Campos"
    )
    expect(pickOfficialCityName("SAO PAULO", " São Paulo ")).toBe("São Paulo")
  })

  it("fica com o nome da Receita se o CEP é de outro município ou não veio", () => {
    expect(pickOfficialCityName("Campinas", "Valinhos")).toBe("Campinas")
    expect(pickOfficialCityName("Campinas", null)).toBe("Campinas")
    expect(pickOfficialCityName("Campinas", "")).toBe("Campinas")
  })
})

import { describe, expect, it } from "vitest"

import {
  forecastByBroker,
  hasForecastData,
  isForecastBucket,
  isForecastPurpose,
  sumBrokerForecasts,
  summarizeForecast,
  type ForecastRow,
} from "./sales-forecast"

function row(partial: Partial<ForecastRow>): ForecastRow {
  return {
    userId: "u-ana",
    name: "Ana",
    teamId: "t-sul",
    teamName: "Zona Sul",
    bucket: "current_month",
    purpose: "sale",
    proposals: 1,
    amount: 0,
    weightedAmount: 0,
    ...partial,
  }
}

describe("summarizeForecast", () => {
  it("2 enviadas de R$ 500 mil a 30% e 1 contraproposta de R$ 400 mil a 50%: ponderado R$ 500 mil", () => {
    const summary = summarizeForecast([
      // O banco agrupa por corretor/faixa/finalidade: as duas enviadas chegam somadas.
      row({ proposals: 2, amount: 1_000_000, weightedAmount: 300_000 }),
      row({ userId: "u-bia", name: "Bia", proposals: 1, amount: 400_000, weightedAmount: 200_000 }),
    ])

    expect(summary.sale.current_month).toEqual({
      proposals: 3,
      amount: 1_400_000,
      weightedAmount: 500_000,
    })
    expect(summary.sale.monthForecast).toBe(500_000)
  })

  it("locação não entra na soma de venda", () => {
    const summary = summarizeForecast([
      row({ amount: 800_000, weightedAmount: 240_000 }),
      row({ purpose: "rent", amount: 3_000, weightedAmount: 900 }),
    ])

    expect(summary.sale.monthForecast).toBe(240_000)
    expect(summary.rent.monthForecast).toBe(900)
  })

  it("sem data aparece na própria faixa e não soma no mês", () => {
    const summary = summarizeForecast([
      row({ bucket: "no_date", amount: 600_000, weightedAmount: 180_000 }),
    ])

    expect(summary.sale.no_date.proposals).toBe(1)
    expect(summary.sale.monthForecast).toBe(0)
  })

  it("comprometido entra pelo valor cheio", () => {
    const summary = summarizeForecast([
      row({ bucket: "committed", amount: 450_000, weightedAmount: 450_000 }),
      row({ amount: 100_000, weightedAmount: 50_000 }),
      row({ bucket: "next_month", amount: 900_000, weightedAmount: 90_000 }),
      row({ bucket: "overdue", amount: 200_000, weightedAmount: 60_000 }),
    ])

    expect(summary.sale.monthForecast).toBe(500_000)
    expect(hasForecastData(summary)).toBe(true)
  })

  it("sem linhas não há dado", () => {
    expect(hasForecastData(summarizeForecast([]))).toBe(false)
  })
})

describe("forecastByBroker", () => {
  it("uma linha por corretor, ordenada pela previsão do mês, com venda e locação separadas", () => {
    const brokers = forecastByBroker([
      row({ amount: 100_000, weightedAmount: 30_000 }),
      row({ purpose: "rent", amount: 4_000, weightedAmount: 2_000 }),
      row({ userId: "u-bia", name: "Bia", bucket: "committed", amount: 300_000 }),
      row({ userId: null, name: "Sem corretor", bucket: "no_date", amount: 50_000 }),
    ])

    expect(brokers.map((broker) => broker.name)).toEqual(["Bia", "Ana", "Sem corretor"])
    expect(brokers[1]?.sale.monthForecast).toBe(30_000)
    expect(brokers[1]?.rent.monthForecast).toBe(2_000)
    expect(brokers[0]?.sale.committed.amount).toBe(300_000)
  })
})

describe("sumBrokerForecasts", () => {
  it("a soma dos corretores é igual ao resumo das linhas", () => {
    const rows = [
      row({ amount: 100_000, weightedAmount: 30_000 }),
      row({ purpose: "rent", amount: 4_000, weightedAmount: 2_000 }),
      row({ userId: "u-bia", name: "Bia", bucket: "committed", amount: 300_000 }),
      row({ userId: "u-bia", name: "Bia", bucket: "no_date", amount: 0.1 }),
      row({ userId: null, name: "Sem corretor", bucket: "no_date", amount: 0.2 }),
    ]

    expect(sumBrokerForecasts(forecastByBroker(rows))).toEqual(summarizeForecast(rows))
  })
})

describe("guardas", () => {
  it("reconhece faixa e finalidade", () => {
    expect(isForecastBucket("current_month")).toBe(true)
    expect(isForecastBucket("amanha")).toBe(false)
    expect(isForecastPurpose("rent")).toBe(true)
    expect(isForecastPurpose("sale_rent")).toBe(false)
  })
})

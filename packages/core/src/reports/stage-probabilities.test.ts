import { describe, expect, it } from "vitest"

import {
  DEFAULT_STAGE_PROBABILITIES,
  describeProbabilityOrder,
  isDefaultStageProbabilities,
  isValidProbability,
  toStageProbabilities,
  weightedAmountCents,
  weightedPipelineCents,
} from "./stage-probabilities"

describe("probabilidade por etapa", () => {
  it("padrões iguais aos do banco", () => {
    expect(DEFAULT_STAGE_PROBABILITIES).toEqual({ draft: 10, sent: 30, countered: 50 })
    expect(isDefaultStageProbabilities({ draft: 10, sent: 30, countered: 50 })).toBe(true)
    expect(isDefaultStageProbabilities({ draft: 10, sent: 40, countered: 50 })).toBe(false)
  })

  it("aceita só inteiro de 0 a 100", () => {
    expect(isValidProbability(0)).toBe(true)
    expect(isValidProbability(100)).toBe(true)
    expect(isValidProbability(30.5)).toBe(false)
    expect(isValidProbability(-1)).toBe(false)
    expect(isValidProbability(101)).toBe(false)
    expect(isValidProbability(Number.NaN)).toBe(false)
  })

  it("lê as linhas da RPC e completa com o padrão", () => {
    expect(
      toStageProbabilities([
        { status: "sent", probability: 40 },
        { status: "accepted", probability: 100 },
        { status: "countered", probability: 250 },
      ])
    ).toEqual({ draft: 10, sent: 40, countered: 50 })
  })

  it("avisa quando a chance cai com o avanço da negociação", () => {
    expect(describeProbabilityOrder({ draft: 10, sent: 30, countered: 50 })).toBeNull()
    expect(describeProbabilityOrder({ draft: 40, sent: 30, countered: 50 })).toMatch(/rascunho/)
    expect(describeProbabilityOrder({ draft: 10, sent: 60, countered: 50 })).toMatch(
      /contraproposta/
    )
  })
})

describe("pipeline ponderado", () => {
  it("2 enviadas de R$ 500 mil a 30% + 1 contraproposta de R$ 400 mil a 50% = R$ 500 mil", () => {
    expect(
      weightedPipelineCents(
        [
          { stage: "sent", amountCents: 50_000_000 },
          { stage: "sent", amountCents: 50_000_000 },
          { stage: "countered", amountCents: 40_000_000 },
        ],
        DEFAULT_STAGE_PROBABILITIES
      )
    ).toBe(50_000_000)
  })

  it("limita a probabilidade e ignora valor inválido", () => {
    expect(weightedAmountCents(100_00, 150)).toBe(100_00)
    expect(weightedAmountCents(Number.NaN, 30)).toBe(0)
  })
})

// Probabilidade de fechamento por etapa da proposta (public.proposal_stage_probabilities)
// e o pipeline ponderado da previsão de vendas.
//
// Os padrões repetem private.proposal_default_probability: sem linha gravada, o
// banco usa 10% (rascunho), 30% (enviada) e 50% (contraproposta).

export const FORECAST_OPEN_STAGES = ["draft", "sent", "countered"] as const

export type ForecastOpenStage = (typeof FORECAST_OPEN_STAGES)[number]

export type StageProbabilities = Record<ForecastOpenStage, number>

export const DEFAULT_STAGE_PROBABILITIES: Readonly<StageProbabilities> = Object.freeze({
  draft: 10,
  sent: 30,
  countered: 50,
})

export const FORECAST_STAGE_LABELS: Record<ForecastOpenStage, string> = {
  draft: "Rascunho",
  sent: "Enviada",
  countered: "Contraproposta",
}

export function isForecastOpenStage(value: unknown): value is ForecastOpenStage {
  return typeof value === "string" && (FORECAST_OPEN_STAGES as readonly string[]).includes(value)
}

/** Inteiro de 0 a 100 (a coluna é smallint com CHECK de 0 a 100). */
export function isValidProbability(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 100
}

/**
 * Linhas do get_proposal_stage_probabilities → objeto por etapa. Etapa que não
 * veio ou veio fora do intervalo fica com o padrão.
 */
export function toStageProbabilities(
  rows: readonly { status: string; probability: number | null }[]
): StageProbabilities {
  const result: StageProbabilities = { ...DEFAULT_STAGE_PROBABILITIES }

  for (const row of rows) {
    if (isForecastOpenStage(row.status) && isValidProbability(row.probability)) {
      result[row.status] = row.probability
    }
  }

  return result
}

export function isDefaultStageProbabilities(values: StageProbabilities): boolean {
  return FORECAST_OPEN_STAGES.every((stage) => values[stage] === DEFAULT_STAGE_PROBABILITIES[stage])
}

/**
 * Aviso (não bloqueia): o normal é a chance subir conforme a negociação avança.
 * Devolve o texto do aviso ou null.
 */
export function describeProbabilityOrder(values: StageProbabilities): string | null {
  if (values.sent < values.draft) {
    return "A proposta enviada está com chance menor que o rascunho. Confira se foi de propósito."
  }

  if (values.countered < values.sent) {
    return "A contraproposta está com chance menor que a proposta enviada. Confira se foi de propósito."
  }

  return null
}

/** Valor ponderado em centavos (R$ 500.000 a 30% → R$ 150.000). */
export function weightedAmountCents(amountCents: number, probability: number): number {
  if (!Number.isFinite(amountCents) || !Number.isFinite(probability)) {
    return 0
  }

  const clamped = Math.min(Math.max(probability, 0), 100)
  return Math.round((amountCents * clamped) / 100)
}

export type ForecastProposalInput = {
  stage: ForecastOpenStage
  amountCents: number
}

/** Soma do pipeline ponderado de propostas em aberto com as probabilidades dadas. */
export function weightedPipelineCents(
  proposals: readonly ForecastProposalInput[],
  probabilities: StageProbabilities
): number {
  return proposals.reduce(
    (total, proposal) =>
      total + weightedAmountCents(proposal.amountCents, probabilities[proposal.stage]),
    0
  )
}

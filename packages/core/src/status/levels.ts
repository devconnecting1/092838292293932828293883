/**
 * Página de status — níveis: ordem de gravidade, pior nível, situação geral e
 * nível de cada parte a partir da medição automática e dos incidentes.
 *
 * Funções puras, espelho das regras do banco (migração status_page_public):
 * `private.status_level_rank`, `private.status_impact_level` e o cálculo de
 * `public.get_public_status`. Mudou aqui, mude lá (e vice-versa).
 */

import {
  STATUS_COMPONENT_KEYS,
  STATUS_LEVELS,
  type IncidentImpact,
  type StatusComponentKey,
  type StatusLevel,
} from "./public"

/**
 * Gravidade para escolher o pior nível. Manutenção fica logo acima de
 * "operacional": só aparece quando nada está pior (lentidão, instabilidade ou
 * fora do ar vencem a manutenção).
 */
export const STATUS_LEVEL_RANK: Record<StatusLevel, number> = {
  operational: 0,
  under_maintenance: 1,
  degraded_performance: 2,
  partial_outage: 3,
  major_outage: 4,
}

/** Níveis que a medição automática pode registrar (manutenção só vem da equipe). */
export const MEASURED_STATUS_LEVELS = [
  "operational",
  "degraded_performance",
  "partial_outage",
  "major_outage",
] as const

export type MeasuredStatusLevel = (typeof MEASURED_STATUS_LEVELS)[number]

export const INCIDENT_IMPACTS = ["none", "minor", "major", "critical"] as const

/** Nível que um incidente em aberto impõe às partes afetadas. */
export const INCIDENT_IMPACT_LEVEL: Record<IncidentImpact, StatusLevel> = {
  none: "operational",
  minor: "degraded_performance",
  major: "partial_outage",
  critical: "major_outage",
}

/**
 * Partes sem regra automática: só a equipe muda a situação (incidente/manutenção).
 * Vazio desde que "Assinaturas e pagamentos" passou a ser medida pelas entregas
 * do webhook da Stripe (billing-webhook.ts). Uma parte com regra pode estar sem
 * sinal ligado: isso vem do banco (`automaticSignal`).
 */
export const MANUAL_STATUS_COMPONENTS: readonly StatusComponentKey[] = []

export function isStatusLevel(value: unknown): value is StatusLevel {
  return typeof value === "string" && (STATUS_LEVELS as readonly string[]).includes(value)
}

export function isMeasuredStatusLevel(value: unknown): value is MeasuredStatusLevel {
  return typeof value === "string" && (MEASURED_STATUS_LEVELS as readonly string[]).includes(value)
}

export function isStatusComponentKey(value: unknown): value is StatusComponentKey {
  return typeof value === "string" && (STATUS_COMPONENT_KEYS as readonly string[]).includes(value)
}

export function isIncidentImpact(value: unknown): value is IncidentImpact {
  return typeof value === "string" && (INCIDENT_IMPACTS as readonly string[]).includes(value)
}

/** O pior de dois níveis (empate fica com o primeiro). */
export function worseStatusLevel(a: StatusLevel, b: StatusLevel): StatusLevel {
  return STATUS_LEVEL_RANK[b] > STATUS_LEVEL_RANK[a] ? b : a
}

/** O pior nível da lista; lista vazia = operacional. */
export function worstStatusLevel(levels: Iterable<StatusLevel | null | undefined>): StatusLevel {
  let worst: StatusLevel = "operational"

  for (const level of levels) {
    if (level) {
      worst = worseStatusLevel(worst, level)
    }
  }

  return worst
}

/** Situação geral da página: a pior entre as partes (manutenção só quando nada está pior). */
export function overallStatusLevel(levels: Iterable<StatusLevel>): StatusLevel {
  return worstStatusLevel(levels)
}

/** A medição conta como "no ar" para a disponibilidade? (lentidão conta; instabilidade não) */
export function isAvailableLevel(level: StatusLevel): boolean {
  return level === "operational" || level === "degraded_performance"
}

export type ComponentLevelInput = {
  /** Nível automático já estabilizado (histerese); null sem medição. */
  measured: StatusLevel | null
  /** Impactos dos incidentes em aberto que afetam a parte. */
  incidentImpacts: readonly IncidentImpact[]
  /** Há manutenção em andamento nesta parte? */
  maintenanceInProgress: boolean
}

/**
 * Nível atual de uma parte:
 * - incidente em aberto impõe o nível do impacto (nenhum → operacional,
 *   pequeno → lentidão, grande → instabilidade parcial, crítico → fora do ar);
 * - manutenção em andamento mostra "Em manutenção" e ignora a medição
 *   automática (a parada é esperada), mas um incidente pior ainda vence;
 * - sem manutenção, vale o pior entre incidente e medição; sem nada, operacional.
 */
export function componentStatusLevel(input: ComponentLevelInput): StatusLevel {
  const incidentLevel = worstStatusLevel(
    input.incidentImpacts.map((impact) => INCIDENT_IMPACT_LEVEL[impact])
  )

  if (input.maintenanceInProgress) {
    return STATUS_LEVEL_RANK[incidentLevel] > STATUS_LEVEL_RANK.under_maintenance
      ? incidentLevel
      : "under_maintenance"
  }

  return worseStatusLevel(incidentLevel, input.measured ?? "operational")
}

export type HysteresisState = {
  /** Nível estável atual; null antes da primeira mudança confirmada. */
  level: MeasuredStatusLevel | null
  /** Nível diferente visto nas últimas medições, esperando confirmação. */
  candidate: MeasuredStatusLevel | null
  candidateCount: number
}

/** Medições seguidas iguais para o nível automático mudar. */
export const STATUS_HYSTERESIS_SAMPLES = 2

/**
 * Histerese (evita piscar): o nível só muda depois de
 * `STATUS_HYSTERESIS_SAMPLES` medições seguidas iguais e diferentes do atual.
 * Uma medição igual ao nível atual zera a espera. Espelho de
 * `private.status_record_sample`.
 */
export function applyStatusHysteresis(
  state: HysteresisState,
  measured: MeasuredStatusLevel
): HysteresisState {
  if (measured === state.level) {
    return { level: state.level, candidate: null, candidateCount: 0 }
  }

  const count = measured === state.candidate ? state.candidateCount + 1 : 1

  if (count >= STATUS_HYSTERESIS_SAMPLES) {
    return { level: measured, candidate: null, candidateCount: 0 }
  }

  return { level: state.level, candidate: measured, candidateCount: count }
}

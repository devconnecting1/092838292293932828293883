/**
 * Taxas e durações dos relatórios.
 *
 * Os números crus (quantos entraram, quantos avançaram, quantas horas) vêm
 * somados do Postgres; aqui só se faz a divisão e o texto. Divisão é sempre
 * defensiva: denominador zero, negativo ou não finito devolve `null`, e a tela
 * mostra "—" em vez de "NaN%" ou "Infinity".
 */

const PERCENT = new Intl.NumberFormat("pt-BR", {
  style: "percent",
  maximumFractionDigits: 1,
})

const DECIMAL = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 })
const INTEGER = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 })

const MINUTES_IN_HOUR = 60
const HOURS_IN_DAY = 24

/** Fração de 0 a 1, ou `null` quando não há base para a conta. */
export function rate(part: number, total: number): number | null {
  if (!Number.isFinite(part) || !Number.isFinite(total) || total <= 0) {
    return null
  }

  // Um lead pode entrar duas vezes na mesma etapa: a fatia nunca passa de 1.
  return Math.min(Math.max(part / total, 0), 1)
}

/** "12,5%" — e "—" quando não dá para calcular. */
export function formatRate(value: number | null | undefined): string {
  return value === null || value === undefined || !Number.isFinite(value)
    ? "—"
    : PERCENT.format(value).replace(/\s/g, " ")
}

/** A mesma taxa como número percentual (12,5), para a coluna da planilha. */
export function ratePercent(value: number | null | undefined): number | null {
  return value === null || value === undefined || !Number.isFinite(value)
    ? null
    : Math.round(value * 1000) / 10
}

export function formatInteger(value: number | null | undefined): string {
  return value === null || value === undefined || !Number.isFinite(value)
    ? "—"
    : INTEGER.format(value)
}

export function formatDecimal(value: number | null | undefined): string {
  return value === null || value === undefined || !Number.isFinite(value)
    ? "—"
    : DECIMAL.format(value)
}

/**
 * Duração em horas para leitura humana: "18 min", "2 h 30 min", "3 d 4 h".
 * É assim que o tempo em cada fase aparece na tela — "36.00" não diz nada a um
 * gerente, "1 d 12 h" diz.
 */
export function formatHours(hours: number | null | undefined): string {
  if (hours === null || hours === undefined || !Number.isFinite(hours) || hours < 0) {
    return "—"
  }

  const totalMinutes = Math.round(hours * MINUTES_IN_HOUR)

  if (totalMinutes < MINUTES_IN_HOUR) {
    return `${totalMinutes} min`
  }

  const totalHours = Math.floor(totalMinutes / MINUTES_IN_HOUR)
  const minutes = totalMinutes % MINUTES_IN_HOUR

  if (totalHours < HOURS_IN_DAY) {
    return minutes > 0 ? `${totalHours} h ${minutes} min` : `${totalHours} h`
  }

  const days = Math.floor(totalHours / HOURS_IN_DAY)
  const restHours = totalHours % HOURS_IN_DAY

  return restHours > 0 ? `${days} d ${restHours} h` : `${days} d`
}

/** Mesma leitura, a partir de minutos (é assim que o SLA é medido). */
export function formatMinutes(minutes: number | null | undefined): string {
  return minutes === null || minutes === undefined || !Number.isFinite(minutes)
    ? "—"
    : formatHours(minutes / MINUTES_IN_HOUR)
}

// -----------------------------------------------------------------------------
// Desempenho por corretor
// -----------------------------------------------------------------------------

export type BrokerCounters = {
  leadsReceived: number
  leadsAnswered: number
  leadsInSla: number
  leadsWon: number
  leadsLost: number
  proposalsMade: number
  proposalsClosed: number
}

export type BrokerRates = {
  /** Atendidos ÷ recebidos: quanto da carteira entregue teve primeiro contato. */
  answerRate: number | null
  /** Dentro do prazo ÷ recebidos: é a promessa de SLA sendo cumprida ou não. */
  slaRate: number | null
  /** Ganhos ÷ (ganhos + perdidos): taxa de fechamento do que foi decidido. */
  winRate: number | null
  /** Propostas fechadas ÷ propostas feitas. */
  proposalCloseRate: number | null
}

export function brokerRates(counters: BrokerCounters): BrokerRates {
  return {
    answerRate: rate(counters.leadsAnswered, counters.leadsReceived),
    slaRate: rate(counters.leadsInSla, counters.leadsReceived),
    winRate: rate(counters.leadsWon, counters.leadsWon + counters.leadsLost),
    proposalCloseRate: rate(counters.proposalsClosed, counters.proposalsMade),
  }
}

// -----------------------------------------------------------------------------
// Funil por etapa
// -----------------------------------------------------------------------------

export type StageCounters = {
  /** Quantas vezes um lead entrou nesta etapa no período. */
  entered: number
  /** Dessas, quantas seguiram para uma etapa adiante no funil. */
  advanced: number
  /** Dessas, quantas acabaram em "Perdido". */
  lostAfter: number
  /** Dessas, quantas continuam nesta etapa hoje. */
  stillThere: number
}

export type StageRates = {
  /** A taxa que o diretor pede: quanto passa desta etapa para a seguinte. */
  advanceRate: number | null
  lossRate: number | null
  /** Parados na etapa: onde o atendimento está travando. */
  stuckRate: number | null
  /** Saíram da etapa (avançaram ou perderam) mas não estão mais aqui. */
  left: number
}

export function stageRates(counters: StageCounters): StageRates {
  return {
    advanceRate: rate(counters.advanced, counters.entered),
    lossRate: rate(counters.lostAfter, counters.entered),
    stuckRate: rate(counters.stillThere, counters.entered),
    left: Math.max(counters.entered - counters.stillThere, 0),
  }
}

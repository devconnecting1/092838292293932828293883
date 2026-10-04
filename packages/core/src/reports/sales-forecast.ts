/**
 * Previsão de vendas (aba "Previsão" de /relatorios).
 *
 * O banco (`report_sales_forecast`) devolve, por corretor, finalidade e faixa
 * da data prevista, a quantidade de propostas, o valor bruto e o valor
 * ponderado pela probabilidade da etapa (rascunho, enviada, contraproposta). As
 * aceitas no mês entram na faixa "committed" com 100%.
 *
 * Previsão do mês = comprometido (aceitas no mês) + ponderado das propostas em
 * aberto com data prevista no mês. Venda e locação NUNCA se somam.
 */

export const FORECAST_BUCKETS = [
  "committed",
  "current_month",
  "overdue",
  "next_month",
  "later",
  "no_date",
] as const

export type ForecastBucket = (typeof FORECAST_BUCKETS)[number]

export const FORECAST_BUCKET_LABELS: Record<ForecastBucket, string> = {
  committed: "Comprometido (aceitas no mês)",
  current_month: "Previstas para este mês",
  overdue: "Data prevista vencida",
  next_month: "Previstas para o próximo mês",
  later: "Previstas para depois",
  no_date: "Sem data prevista",
}

export function isForecastBucket(value: unknown): value is ForecastBucket {
  return typeof value === "string" && (FORECAST_BUCKETS as readonly string[]).includes(value)
}

export const FORECAST_PURPOSES = ["sale", "rent"] as const

export type ForecastPurpose = (typeof FORECAST_PURPOSES)[number]

export function isForecastPurpose(value: unknown): value is ForecastPurpose {
  return value === "sale" || value === "rent"
}

export type ForecastRow = {
  userId: string | null
  name: string
  teamId: string | null
  teamName: string | null
  bucket: ForecastBucket
  purpose: ForecastPurpose
  proposals: number
  amount: number
  weightedAmount: number
}

export type ForecastCell = {
  proposals: number
  amount: number
  weightedAmount: number
}

export type PurposeForecast = Record<ForecastBucket, ForecastCell> & {
  /** Comprometido + ponderado das previstas para o mês. */
  monthForecast: number
}

export type ForecastSummary = Record<ForecastPurpose, PurposeForecast>

function cents(value: number) {
  return Math.round(value * 100) / 100
}

function finite(value: number) {
  return Number.isFinite(value) ? value : 0
}

function emptyPurpose(): PurposeForecast {
  const cells = Object.fromEntries(
    FORECAST_BUCKETS.map((bucket) => [bucket, { proposals: 0, amount: 0, weightedAmount: 0 }])
  ) as Record<ForecastBucket, ForecastCell>

  return { ...cells, monthForecast: 0 }
}

function addRow(target: PurposeForecast, row: ForecastRow) {
  const cell = target[row.bucket]

  cell.proposals += finite(row.proposals)
  cell.amount = cents(cell.amount + finite(row.amount))
  cell.weightedAmount = cents(cell.weightedAmount + finite(row.weightedAmount))
}

function closePurpose(target: PurposeForecast) {
  // O comprometido entra pelo valor cheio (100%): o ponderado dele é o próprio valor.
  target.monthForecast = cents(target.committed.amount + target.current_month.weightedAmount)
}

export function summarizeForecast(rows: readonly ForecastRow[]): ForecastSummary {
  const summary: ForecastSummary = { sale: emptyPurpose(), rent: emptyPurpose() }

  for (const row of rows) {
    addRow(summary[row.purpose], row)
  }

  closePurpose(summary.sale)
  closePurpose(summary.rent)

  return summary
}

export type BrokerForecast = {
  /** `null` = propostas sem corretor. */
  userId: string | null
  name: string
  teamId: string | null
  teamName: string | null
  sale: PurposeForecast
  rent: PurposeForecast
}

/**
 * Uma linha por corretor, ordenada pela previsão do mês (venda + locação só
 * para ORDENAR; a tela mostra as duas separadas).
 */
export function forecastByBroker(rows: readonly ForecastRow[]): BrokerForecast[] {
  const byBroker = new Map<string, BrokerForecast>()

  for (const row of rows) {
    const key = row.userId ?? ""
    let broker = byBroker.get(key)

    if (!broker) {
      broker = {
        userId: row.userId,
        name: row.name,
        teamId: row.teamId,
        teamName: row.teamName,
        sale: emptyPurpose(),
        rent: emptyPurpose(),
      }
      byBroker.set(key, broker)
    }

    addRow(broker[row.purpose], row)
  }

  const brokers = [...byBroker.values()]

  for (const broker of brokers) {
    closePurpose(broker.sale)
    closePurpose(broker.rent)
  }

  return brokers.sort(
    (a, b) =>
      b.sale.monthForecast + b.rent.monthForecast - (a.sale.monthForecast + a.rent.monthForecast) ||
      a.name.localeCompare(b.name, "pt-BR")
  )
}

/**
 * Soma de um grupo de corretores (subtotal de equipe). É a mesma conta de
 * `summarizeForecast`, só que sobre linhas já agrupadas por corretor.
 */
export function sumBrokerForecasts(
  brokers: readonly Pick<BrokerForecast, "sale" | "rent">[]
): ForecastSummary {
  const total: ForecastSummary = { sale: emptyPurpose(), rent: emptyPurpose() }

  for (const broker of brokers) {
    for (const purpose of FORECAST_PURPOSES) {
      for (const bucket of FORECAST_BUCKETS) {
        const cell = broker[purpose][bucket]
        const target = total[purpose][bucket]

        target.proposals += finite(cell.proposals)
        target.amount = cents(target.amount + finite(cell.amount))
        target.weightedAmount = cents(target.weightedAmount + finite(cell.weightedAmount))
      }
    }
  }

  closePurpose(total.sale)
  closePurpose(total.rent)

  return total
}

/** Há alguma proposta em aberto ou aceita no mês no recorte? */
export function hasForecastData(summary: ForecastSummary): boolean {
  return FORECAST_PURPOSES.some((purpose) =>
    FORECAST_BUCKETS.some((bucket) => summary[purpose][bucket].proposals > 0)
  )
}

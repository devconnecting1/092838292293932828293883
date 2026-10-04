// Investimento em marketing (public.marketing_investments) e custo por lead.
//
// Dinheiro é sempre CENTAVO inteiro aqui: o banco guarda numeric(14,2) em reais
// e só a borda (Server Action e consulta) converte. Mês é "AAAA-MM" na tela e
// "AAAA-MM-01" no banco (CHECK marketing_investments_month_check).

/** Mesmo teto do CHECK marketing_investments_campaign_check. */
export const MARKETING_CAMPAIGN_MAX_LENGTH = 200
/** Mesmo teto do CHECK marketing_investments_notes_check. */
export const MARKETING_NOTES_MAX_LENGTH = 500
/** numeric(14,2): até 999.999.999.999,99. */
export const MARKETING_INVESTMENT_MAX_CENTS = 99_999_999_999_999

const MONTH_KEY_PATTERN = /^(\d{4})-(\d{2})$/
const MIN_YEAR = 2000
const MAX_YEAR = 2099

const MONTH_NAMES = [
  "janeiro",
  "fevereiro",
  "março",
  "abril",
  "maio",
  "junho",
  "julho",
  "agosto",
  "setembro",
  "outubro",
  "novembro",
  "dezembro",
] as const

// -----------------------------------------------------------------------------
// Mês
// -----------------------------------------------------------------------------

/** "2026-09" → { year: 2026, month: 9 }; fora de 2000-01..2099-12 → null. */
export function parseMonthKey(value: unknown): { year: number; month: number } | null {
  if (typeof value !== "string") {
    return null
  }

  const match = MONTH_KEY_PATTERN.exec(value.trim())

  if (!match) {
    return null
  }

  const year = Number(match[1])
  const month = Number(match[2])

  if (year < MIN_YEAR || year > MAX_YEAR || month < 1 || month > 12) {
    return null
  }

  return { year, month }
}

export function isMonthKey(value: unknown): value is string {
  return parseMonthKey(value) !== null
}

function toMonthKey(year: number, month: number) {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}`
}

/** "2026-09" → "2026-09-01" (coluna month). */
export function monthKeyToDate(key: string): string {
  const parsed = parseMonthKey(key)

  if (!parsed) {
    throw new Error(`Mês inválido: ${key}`)
  }

  return `${toMonthKey(parsed.year, parsed.month)}-01`
}

/** "2026-09-01" (ou qualquer dia do mês) → "2026-09". Inválido → null. */
export function dateToMonthKey(value: string | null | undefined): string | null {
  if (!value) {
    return null
  }

  const key = value.slice(0, 7)
  return isMonthKey(key) ? key : null
}

/** Soma (ou subtrai) meses; sai do intervalo aceito → null. */
export function shiftMonthKey(key: string, delta: number): string | null {
  const parsed = parseMonthKey(key)

  if (!parsed || !Number.isInteger(delta)) {
    return null
  }

  const index = parsed.year * 12 + (parsed.month - 1) + delta
  const next = toMonthKey(Math.floor(index / 12), (index % 12) + 1)
  return isMonthKey(next) ? next : null
}

/** "2026-09" → "setembro de 2026". */
export function formatMonthLabel(key: string): string {
  const parsed = parseMonthKey(key)
  return parsed ? `${MONTH_NAMES[parsed.month - 1]} de ${parsed.year}` : key
}

/** Meses do mais recente ao mais antigo, de `ahead` meses à frente até `back` meses atrás. */
export function listMonthKeys(center: string, back: number, ahead: number): string[] {
  const keys: string[] = []

  for (let delta = ahead; delta >= -back; delta -= 1) {
    const key = shiftMonthKey(center, delta)

    if (key) {
      keys.push(key)
    }
  }

  return keys
}

/** Dias do mês (setembro de 2026 → 30). */
export function daysInMonthKey(key: string): number {
  const parsed = parseMonthKey(key)
  return parsed ? new Date(Date.UTC(parsed.year, parsed.month, 0)).getUTCDate() : 0
}

// -----------------------------------------------------------------------------
// Campanha e dinheiro
// -----------------------------------------------------------------------------

/** Campanha como o banco grava: sem espaços nas pontas; vazia → null. */
export function normalizeCampaign(value: string | null | undefined): string | null {
  const trimmed = (value ?? "").trim()
  return trimmed === "" ? null : trimmed
}

/**
 * Chave de unicidade (índice marketing_investments_key): mês + canal + campanha
 * sem diferença de maiúsculas. Duas linhas com a mesma chave são o mesmo lançamento.
 */
export function investmentKey(entry: {
  month: string
  source: string
  campaign: string | null | undefined
}): string {
  return [
    entry.month.slice(0, 7),
    entry.source,
    (normalizeCampaign(entry.campaign) ?? "").toLocaleLowerCase("pt-BR"),
  ].join("|")
}

/** Reais do banco (número ou texto "1234.56") → centavos inteiros. Inválido → 0. */
export function reaisToCents(value: number | string | null | undefined): number {
  const parsed = typeof value === "string" ? Number(value) : (value ?? 0)
  return Number.isFinite(parsed) ? Math.round(parsed * 100) || 0 : 0
}

/** Centavos → reais para gravar (123456 → 1234.56). */
export function centsToReais(cents: number): number {
  return Math.round(cents) / 100
}

// -----------------------------------------------------------------------------
// Resumo do mês e custo por lead
// -----------------------------------------------------------------------------

export type InvestmentEntry<S extends string = string> = {
  source: S
  campaign: string | null
  amountCents: number
}

export type SourceInvestmentSummary<S extends string = string> = {
  source: S
  totalCents: number
  /** Lançado sem campanha: cobre os leads do canal sem campanha com investimento próprio. */
  channelCents: number
  campaigns: { campaign: string; amountCents: number }[]
}

/** Total do mês por canal (maior primeiro) e total geral. */
export function summarizeInvestmentsBySource<S extends string>(
  entries: readonly InvestmentEntry<S>[]
): { totalCents: number; sources: SourceInvestmentSummary<S>[] } {
  const bySource = new Map<S, SourceInvestmentSummary<S>>()
  let totalCents = 0

  for (const entry of entries) {
    const amount = Math.max(Math.round(entry.amountCents), 0)
    const summary = bySource.get(entry.source) ?? {
      source: entry.source,
      totalCents: 0,
      channelCents: 0,
      campaigns: [],
    }
    const campaign = normalizeCampaign(entry.campaign)

    summary.totalCents += amount
    totalCents += amount

    if (campaign === null) {
      summary.channelCents += amount
    } else {
      summary.campaigns.push({ campaign, amountCents: amount })
    }

    bySource.set(entry.source, summary)
  }

  const sources = [...bySource.values()]

  for (const summary of sources) {
    summary.campaigns.sort(
      (a, b) => b.amountCents - a.amountCents || a.campaign.localeCompare(b.campaign, "pt-BR")
    )
  }

  sources.sort((a, b) => b.totalCents - a.totalCents || a.source.localeCompare(b.source))

  return { totalCents, sources }
}

/** Custo por lead (ou por ganho) em centavos; sem lead → null (a tela mostra "—"). */
export function costPerLeadCents(investmentCents: number, leads: number): number | null {
  if (!Number.isFinite(investmentCents) || !Number.isFinite(leads) || leads <= 0) {
    return null
  }

  return Math.round(investmentCents / leads)
}

/**
 * Parte do investimento mensal que cai num período: proporcional aos dias do
 * mês cobertos (o banco faz a mesma conta em segundos, no fuso de Brasília).
 */
export function prorateMonthlyInvestmentCents(
  amountCents: number,
  coveredDays: number,
  daysInMonth: number
): number {
  if (!Number.isFinite(amountCents) || daysInMonth <= 0 || coveredDays <= 0) {
    return 0
  }

  return Math.round((amountCents * Math.min(coveredDays, daysInMonth)) / daysInMonth)
}

/**
 * Console da Plataforma — linguagem comum da tela "Saúde do sistema".
 *
 * Cada verificação vira um `HealthItem` com estado (ok, atenção ou problema), o
 * que foi encontrado e o que fazer. Funções puras: não leem ambiente nem banco,
 * e nenhum texto aqui carrega valor de segredo ou dado pessoal — quem monta os
 * itens só recebe presença, contagens, horários e estados.
 */

export const HEALTH_STATUSES = ["ok", "atencao", "problema"] as const

export type HealthStatus = (typeof HEALTH_STATUSES)[number]

export const HEALTH_STATUS_LABELS: Record<HealthStatus, string> = {
  ok: "OK",
  atencao: "Atenção",
  problema: "Problema",
}

const SEVERITY: Record<HealthStatus, number> = { ok: 0, atencao: 1, problema: 2 }

export type HealthItem = {
  /** Identificador estável (chave de lista e testes). */
  key: string
  /** Nome curto do que foi verificado, em pt-BR. */
  label: string
  /** Nome técnico mostrado em fonte monoespaçada (variável, segredo, rotina). */
  reference: string | null
  status: HealthStatus
  /** O que foi encontrado. */
  detail: string
  /** O que fazer. Null quando não há nada a fazer. */
  action: string | null
}

export type HealthSection = {
  key: string
  title: string
  description: string
  status: HealthStatus
  items: HealthItem[]
  /** Por que a parte não pôde ser verificada (ex.: chave do servidor ausente). */
  unavailable: string | null
}

export type HealthSummary = Record<HealthStatus, number> & { status: HealthStatus }

/** Pior estado da lista; lista vazia é ok. */
export function worstStatus(statuses: Iterable<HealthStatus>): HealthStatus {
  let worst: HealthStatus = "ok"

  for (const status of statuses) {
    if (SEVERITY[status] > SEVERITY[worst]) {
      worst = status
    }
  }

  return worst
}

/** Problemas primeiro, depois atenção, depois ok; empate mantém a ordem original. */
export function sortHealthItems(items: readonly HealthItem[]): HealthItem[] {
  return items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => SEVERITY[b.item.status] - SEVERITY[a.item.status] || a.index - b.index)
    .map(({ item }) => item)
}

/**
 * Monta a seção com o estado calculado. Parte indisponível conta como atenção:
 * não dá para dizer que está tudo bem sem conseguir olhar.
 */
export function buildHealthSection(input: {
  key: string
  title: string
  description: string
  items?: readonly HealthItem[]
  unavailable?: string | null
}): HealthSection {
  const items = sortHealthItems(input.items ?? [])
  const unavailable = input.unavailable ?? null
  const statuses = items.map((item) => item.status)

  return {
    key: input.key,
    title: input.title,
    description: input.description,
    status: worstStatus(unavailable ? [...statuses, "atencao"] : statuses),
    items,
    unavailable,
  }
}

/** Contagem de itens por estado em todas as seções (seção indisponível conta como atenção). */
export function summarizeHealth(sections: readonly HealthSection[]): HealthSummary {
  const summary: HealthSummary = { ok: 0, atencao: 0, problema: 0, status: "ok" }

  for (const section of sections) {
    for (const item of section.items) {
      summary[item.status] += 1
    }

    if (section.unavailable) {
      summary.atencao += 1
    }
  }

  summary.status = worstStatus(
    (["problema", "atencao"] as const).filter((status) => summary[status] > 0)
  )

  return summary
}

const MINUTE_MS = 60_000

function toTime(value: string | Date | null | undefined): number {
  if (value instanceof Date) {
    return value.getTime()
  }

  return typeof value === "string" && value.trim() ? Date.parse(value) : Number.NaN
}

/** Minutos inteiros entre `from` e `now`; null se a data for inválida. */
export function minutesSince(from: string | Date | null | undefined, now: Date): number | null {
  const time = toTime(from)

  if (Number.isNaN(time)) {
    return null
  }

  return Math.max(0, Math.floor((now.getTime() - time) / MINUTE_MS))
}

/** Duração em pt-BR: "menos de 1 min", "5 min", "3 h", "2 dias". */
export function formatDurationMinutes(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes < 1) {
    return "menos de 1 min"
  }

  if (minutes < 60) {
    return `${Math.floor(minutes)} min`
  }

  if (minutes < 48 * 60) {
    return `${Math.floor(minutes / 60)} h`
  }

  const days = Math.floor(minutes / (24 * 60))
  return `${days} dias`
}

/** "há 5 min", "há 3 h"; "em data desconhecida" se a data for inválida. */
export function describeAge(from: string | Date | null | undefined, now: Date): string {
  const minutes = minutesSince(from, now)
  return minutes === null ? "em data desconhecida" : `há ${formatDurationMinutes(minutes)}`
}

/** Plural simples em pt-BR: 1 item, 2 itens. */
export function pluralize(count: number, singular: string, plural: string): string {
  return `${new Intl.NumberFormat("pt-BR").format(count)} ${count === 1 ? singular : plural}`
}

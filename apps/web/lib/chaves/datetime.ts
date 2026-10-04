// Conversão entre <input type="datetime-local"> e ISO no fuso de Brasília.

const TIME_ZONE = "America/Sao_Paulo"
/** O Brasil não tem horário de verão desde 2019: Brasília é sempre UTC-3. */
const BRASILIA_UTC_OFFSET = "-03:00"
const LOCAL_INPUT_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/

const partsFormat = new Intl.DateTimeFormat("en-CA", {
  timeZone: TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
})

/** "2026-09-15T14:30" (horário de Brasília) → ISO UTC. Inválido → null. */
export function localInputToIso(value: string) {
  if (!LOCAL_INPUT_PATTERN.test(value)) {
    return null
  }

  const date = new Date(`${value}:00${BRASILIA_UTC_OFFSET}`)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

/** Data → "YYYY-MM-DDTHH:mm" no horário de Brasília. */
export function toLocalInput(value: Date | string) {
  const date = value instanceof Date ? value : new Date(value)
  const parts = Object.fromEntries(
    partsFormat.formatToParts(date).map((part) => [part.type, part.value])
  )

  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`
}

/** Data de hoje (YYYY-MM-DD) em Brasília. */
export function todayInSaoPaulo(now: Date = new Date()) {
  return toLocalInput(now).slice(0, 10)
}

/**
 * Coluna `date` do banco ("2026-09-20") → "20/09/2026". Não passa por Date,
 * que interpretaria a data como meia-noite UTC e mostraria o dia anterior.
 */
export function formatDateOnly(value: string | null | undefined) {
  const match = value ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(value) : null
  return match ? `${match[3]}/${match[2]}/${match[1]}` : "—"
}

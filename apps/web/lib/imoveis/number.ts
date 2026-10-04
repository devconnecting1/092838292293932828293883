/**
 * Conversão entre o texto digitado nos formulários (padrão pt-BR) e os
 * valores numéricos gravados no banco. Funções puras: rodam no navegador e no
 * servidor.
 */

function digitsOnly(value: string) {
  return value.replace(/\D/g, "")
}

const brlInputFormat = new Intl.NumberFormat("pt-BR", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

const decimalInputFormat = new Intl.NumberFormat("pt-BR", {
  maximumFractionDigits: 2,
  useGrouping: false,
})

/** Máscara de moeda enquanto digita: "123456" vira "1.234,56". Vazio continua vazio. */
export function maskBrlInput(raw: string) {
  const digits = digitsOnly(raw)
    .replace(/^0+(?=\d)/, "")
    .slice(0, 14)
  if (!digits) return ""
  return brlInputFormat.format(Number(digits) / 100)
}

/** Valor do banco para o campo mascarado: 450000 vira "450.000,00". */
export function formatBrlInputValue(value: number | null | undefined) {
  return value == null ? "" : brlInputFormat.format(value)
}

/** "1.234,56" vira 1234.56. Vazio vira null; texto inválido vira NaN. */
export function parseBrlInput(value: string): number | null {
  const trimmed = value.trim()
  if (!trimmed) return null
  if (!/^[\d.]+(,\d{1,2})?$/.test(trimmed)) return Number.NaN
  return Number(trimmed.replace(/\./g, "").replace(",", "."))
}

/**
 * Número decimal digitado em pt-BR ("1.200,5" ou "85,5"). Um ponto seguido de
 * exatamente três dígitos é separador de milhar; senão é separador decimal.
 */
export function parseDecimalInput(value: string): number | null {
  const trimmed = value.trim().replace(/\s/g, "")
  if (!trimmed) return null

  let normalized: string
  if (trimmed.includes(",")) {
    normalized = trimmed.replace(/\./g, "").replace(",", ".")
  } else if (/^\d{1,3}(\.\d{3})+$/.test(trimmed)) {
    normalized = trimmed.replace(/\./g, "")
  } else {
    normalized = trimmed
  }

  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) return Number.NaN
  return Number(normalized)
}

export function formatDecimalInputValue(value: number | null | undefined) {
  return value == null ? "" : decimalInputFormat.format(value)
}

/** Inteiro (aceita sinal negativo só quando allowNegative). */
export function parseIntegerInput(value: string, allowNegative = false): number | null {
  const trimmed = value.trim()
  if (!trimmed) return null
  const pattern = allowNegative ? /^-?\d+$/ : /^\d+$/
  if (!pattern.test(trimmed)) return Number.NaN
  return Number(trimmed)
}

export function formatIntegerInputValue(value: number | null | undefined) {
  return value == null ? "" : String(value)
}

/** Coordenada com ponto ou vírgula decimal ("-22,9068"). */
export function parseCoordinateInput(value: string): number | null {
  const trimmed = value.trim().replace(",", ".")
  if (!trimmed) return null
  if (!/^-?\d{1,3}(\.\d{1,8})?$/.test(trimmed)) return Number.NaN
  return Number(trimmed)
}

export function formatCoordinateInputValue(value: number | null | undefined) {
  return value == null ? "" : String(value)
}

/** Máscara de CEP enquanto digita: "13010000" vira "13010-000". */
export function maskPostalCodeInput(raw: string) {
  const digits = digitsOnly(raw).slice(0, 8)
  return digits.length > 5 ? `${digits.slice(0, 5)}-${digits.slice(5)}` : digits
}

export function formatPostalCodeInputValue(value: string | null | undefined) {
  return value ? maskPostalCodeInput(value) : ""
}

/** Converte NaN/undefined em null (para gravar no banco). */
export function toNullableNumber(value: number | null) {
  return value == null || Number.isNaN(value) ? null : value
}

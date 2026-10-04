/**
 * Leitura defensiva do que volta das RPCs de relatório: `numeric` do Postgres
 * pode chegar como texto, e qualquer coluna pode vir nula.
 */

export function logReportFailure(scope: string, error: unknown) {
  const detail =
    error && typeof error === "object" && "code" in error && typeof error.code === "string"
      ? error.code
      : error instanceof Error
        ? error.message
        : "erro desconhecido"

  console.error(`[relatorios] falha ao carregar ${scope}:`, detail)
}

export function toNumber(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

export function toNullableNumber(value: unknown): number | null {
  if (value === null || value === undefined) {
    return null
  }

  const parsed = typeof value === "number" ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

export function toText(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null
}

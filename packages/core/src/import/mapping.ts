/**
 * Mapeamento "coluna da planilha → campo do CRM": sugestão automática pelo
 * nome da coluna (pt-BR, sem acento) e conferência do que é obrigatório.
 */

import {
  getNormalizedAliases,
  IMPORT_FIELDS,
  IMPORT_REQUIRED_GROUPS,
  type ImportKind,
} from "./fields"
import { normalizeLabel } from "./normalize"

/** Um campo por coluna (na ordem das colunas); `null` = não importar. */
export type ColumnMapping = (string | null)[]

/** Nota de quanto o nome da coluna parece com o campo. 0 = nada a ver. */
function scoreHeader(header: string, aliases: readonly string[]): number {
  let best = 0

  aliases.forEach((alias, index) => {
    if (!alias) {
      return
    }

    if (header === alias) {
      best = Math.max(best, 1000 - index)
      return
    }

    // Aliases curtos ("n", "uf", "ref") só valem com o nome exato.
    if (alias.length <= 3) {
      return
    }

    if (` ${header} `.includes(` ${alias} `)) {
      best = Math.max(best, 500 + alias.length - index)
    }
  })

  return best
}

/**
 * Sugere o campo de cada coluna. Cada campo vai para no máximo uma coluna: a
 * dupla (coluna, campo) de maior nota ganha primeiro, e a coluna mais à
 * esquerda desempata.
 */
export function suggestColumnMapping(kind: ImportKind, headers: readonly string[]): ColumnMapping {
  const candidates: { column: number; key: string; score: number }[] = []

  headers.forEach((header, column) => {
    const normalized = normalizeLabel(header)

    if (!normalized) {
      return
    }

    for (const field of IMPORT_FIELDS[kind]) {
      const score = scoreHeader(normalized, getNormalizedAliases(kind, field.key))

      if (score > 0) {
        candidates.push({ column, key: field.key, score })
      }
    }
  })

  candidates.sort((a, b) => b.score - a.score || a.column - b.column)

  const mapping: ColumnMapping = headers.map(() => null)
  const usedKeys = new Set<string>()

  for (const candidate of candidates) {
    if (mapping[candidate.column] !== null || usedKeys.has(candidate.key)) {
      continue
    }

    mapping[candidate.column] = candidate.key
    usedKeys.add(candidate.key)
  }

  return mapping
}

/** Troca o campo de uma coluna, tirando o mesmo campo de outra coluna. */
export function setColumnField(
  mapping: ColumnMapping,
  column: number,
  key: string | null
): ColumnMapping {
  return mapping.map((current, index) => {
    if (index === column) {
      return key
    }

    return key !== null && current === key ? null : current
  })
}

/** Grupos obrigatórios que ainda não têm coluna (cada grupo: "pelo menos um destes"). */
export function getMissingRequiredGroups(
  kind: ImportKind,
  mapping: ColumnMapping
): (readonly string[])[] {
  const mapped = new Set(mapping.filter((key): key is string => key !== null))

  return IMPORT_REQUIRED_GROUPS[kind].filter((group) => !group.some((key) => mapped.has(key)))
}

/** Valores de uma linha pelo campo mapeado. Colunas sem campo ficam de fora. */
export function mapRowValues(
  mapping: ColumnMapping,
  cells: readonly string[]
): Record<string, string> {
  const values: Record<string, string> = {}

  mapping.forEach((key, column) => {
    if (key !== null) {
      values[key] = cells[column] ?? ""
    }
  })

  return values
}

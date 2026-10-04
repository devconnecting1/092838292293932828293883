/**
 * Subtotal por equipe nos relatórios.
 *
 * O banco devolve uma linha por corretor já com a equipe ATUAL dele
 * (`team_members` não guarda histórico). Aqui só se agrupa e soma o que já veio
 * agregado — nenhuma conta nova —, então a soma dos subtotais é sempre igual ao
 * total da tela.
 */

export const NO_TEAM_LABEL = "Sem equipe"

export type TeamGroupable = {
  teamId: string | null
  teamName: string | null
}

export type TeamGroup<Row> = {
  /** `null` = corretores que não estão em nenhuma equipe. */
  teamId: string | null
  teamName: string
  rows: Row[]
}

const collator = new Intl.Collator("pt-BR", { sensitivity: "base" })

/**
 * Agrupa as linhas por equipe, mantendo a ordem original dentro de cada grupo
 * (o ranking que veio do banco). Equipes em ordem alfabética; "Sem equipe" por
 * último.
 */
export function groupRowsByTeam<Row extends TeamGroupable>(rows: readonly Row[]): TeamGroup<Row>[] {
  const groups = new Map<string, TeamGroup<Row>>()

  for (const row of rows) {
    const key = row.teamId ?? ""
    let group = groups.get(key)

    if (!group) {
      group = {
        teamId: row.teamId,
        teamName: row.teamId ? row.teamName?.trim() || "Equipe sem nome" : NO_TEAM_LABEL,
        rows: [],
      }
      groups.set(key, group)
    }

    group.rows.push(row)
  }

  return [...groups.values()].sort((a, b) => {
    if (a.teamId === null) return b.teamId === null ? 0 : 1
    if (b.teamId === null) return -1
    return collator.compare(a.teamName, b.teamName)
  })
}

/** Quantas equipes diferentes (contando "Sem equipe") aparecem nas linhas. */
export function countTeamGroups(rows: readonly TeamGroupable[]): number {
  return new Set(rows.map((row) => row.teamId ?? "")).size
}

type NumericKeys<Row> = {
  [Key in keyof Row]: Row[Key] extends number ? Key : never
}[keyof Row]

/**
 * Soma campos numéricos. Valor não finito conta como zero (a tela nunca mostra
 * "NaN" num subtotal).
 */
export function sumFields<Row, Key extends NumericKeys<Row>>(
  rows: readonly Row[],
  keys: readonly Key[]
): Record<Key, number> {
  const totals = Object.fromEntries(keys.map((key) => [key, 0])) as Record<Key, number>

  for (const row of rows) {
    for (const key of keys) {
      const value = row[key] as unknown as number
      totals[key] += Number.isFinite(value) ? value : 0
    }
  }

  for (const key of keys) {
    // Centavos: 0,1 + 0,2 não vira 0,30000000000000004 no rodapé.
    totals[key] = Math.round(totals[key] * 100) / 100
  }

  return totals
}

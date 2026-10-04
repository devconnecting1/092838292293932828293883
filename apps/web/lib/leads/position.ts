import { LEAD_POSITION_STEP } from "@/lib/leads/constants"

/**
 * Ordem dentro de uma coluna do funil. Espelha a consulta do servidor:
 * `position` crescente com nulos primeiro (lead recém-chegado sem posição fica
 * no topo), depois `created_at` decrescente e `id` para desempate estável.
 */
export type PositionedLead = {
  id: string
  position: number | null
  createdAt: string
}

export function compareLeadOrder(a: PositionedLead, b: PositionedLead) {
  if (a.position === null && b.position !== null) return -1
  if (a.position !== null && b.position === null) return 1

  if (a.position !== null && b.position !== null && a.position !== b.position) {
    return a.position - b.position
  }

  if (a.createdAt !== b.createdAt) {
    return a.createdAt < b.createdAt ? 1 : -1
  }

  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

/** Menor diferença aceita entre vizinhos antes de renumerar a coluna. */
const MIN_GAP = 1e-6

export type PositionPlan =
  | { kind: "single"; position: number }
  | { kind: "renumber"; positions: { id: string; position: number }[] }

/**
 * Calcula a posição do lead `movedId` inserido em `index` na coluna `column`
 * (já ordenada e SEM o lead movido). Usa o ponto médio entre os vizinhos;
 * quando algum vizinho não tem posição ou o espaço acabou, renumera a coluna
 * inteira (passo LEAD_POSITION_STEP), preservando a ordem visível.
 */
export function planLeadPosition(
  column: readonly PositionedLead[],
  index: number,
  movedId: string
): PositionPlan {
  const safeIndex = Math.max(0, Math.min(index, column.length))
  const previous = column[safeIndex - 1]
  const next = column[safeIndex]

  const renumber = (): PositionPlan => {
    const ordered = column.map((lead) => lead.id)
    ordered.splice(safeIndex, 0, movedId)

    return {
      kind: "renumber",
      positions: ordered.map((id, order) => ({
        id,
        position: (order + 1) * LEAD_POSITION_STEP,
      })),
    }
  }

  if (!previous && !next) {
    return { kind: "single", position: LEAD_POSITION_STEP }
  }

  if ((previous && previous.position === null) || (next && next.position === null)) {
    return renumber()
  }

  if (!previous && next && next.position !== null) {
    return { kind: "single", position: next.position - LEAD_POSITION_STEP }
  }

  if (previous && previous.position !== null && !next) {
    return { kind: "single", position: previous.position + LEAD_POSITION_STEP }
  }

  if (previous?.position != null && next?.position != null) {
    const gap = next.position - previous.position

    if (gap > MIN_GAP) {
      return { kind: "single", position: previous.position + gap / 2 }
    }
  }

  return renumber()
}

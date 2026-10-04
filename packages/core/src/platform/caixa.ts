/**
 * Console da Plataforma — idade da última carga dos imóveis da Caixa.
 *
 * Mesma regra do lembrete diário (upload-reminder): passou de 24 h, pede um
 * envio novo. Passou de 72 h, o catálogo que as imobiliárias veem já está
 * velho o bastante para virar problema.
 */

import { formatBrDate } from "../caixa/normalize"
import { CAIXA_REMINDER_MAX_AGE_HOURS, CAIXA_UPLOAD_PAGE_PATH } from "../caixa/upload-reminder"
import { describeAge, minutesSince, pluralize, type HealthItem } from "./health"

/** A partir daqui a lista desatualizada vira problema. */
export const CAIXA_STALE_PROBLEM_HOURS = 72

export type CaixaLoadHealthInput = {
  /** caixa_catalog_status.sincronizado_em */
  syncedAt: string | null
  /** caixa_catalog_status.lista_gerada_em (data declarada pela Caixa) */
  listGeneratedOn: string | null
  totalActive: number
  /** caixa_catalog_status.last_result */
  lastResult: string | null
  lastFailureAt: string | null
  /** Frase pronta do motivo da última falha (apps/web/lib/plataforma/caixa-labels). */
  lastFailureLabel: string | null
}

export function evaluateCaixaLoad(input: CaixaLoadHealthInput | null, now: Date): HealthItem {
  const base = {
    key: "caixa_ultima_carga",
    label: "Última carga da lista da Caixa",
    reference: CAIXA_UPLOAD_PAGE_PATH,
  }
  const action = "Baixe a lista geral no site da Caixa e envie em Imóveis da Caixa."

  if (!input?.syncedAt || minutesSince(input.syncedAt, now) === null) {
    return {
      ...base,
      status: "atencao",
      detail: "Nenhuma lista carregada ainda: o catálogo das imobiliárias está vazio.",
      action,
    }
  }

  const ageMinutes = minutesSince(input.syncedAt, now) ?? 0
  const listDate = formatBrDate(input.listGeneratedOn)
  const summary =
    `Carregada ${describeAge(input.syncedAt, now)} · ` +
    `${pluralize(Math.max(0, Math.floor(input.totalActive)), "imóvel ativo", "imóveis ativos")}` +
    (listDate ? ` · lista da Caixa de ${listDate}` : "")

  const failedAfterLoad =
    input.lastResult === "falha" &&
    input.lastFailureAt !== null &&
    Date.parse(input.lastFailureAt) > Date.parse(input.syncedAt)

  if (ageMinutes > CAIXA_STALE_PROBLEM_HOURS * 60) {
    return {
      ...base,
      status: "problema",
      detail: `${summary}. Mais de ${CAIXA_STALE_PROBLEM_HOURS} h sem lista nova.`,
      action,
    }
  }

  if (failedAfterLoad) {
    return {
      ...base,
      status: "atencao",
      detail: `${summary}. A última tentativa falhou ${describeAge(input.lastFailureAt, now)}: ${input.lastFailureLabel ?? "motivo não informado."}`,
      action: "Envie a lista de novo em Imóveis da Caixa; o catálogo anterior continua valendo.",
    }
  }

  if (ageMinutes > CAIXA_REMINDER_MAX_AGE_HOURS * 60) {
    return {
      ...base,
      status: "atencao",
      detail: `${summary}. Mais de ${CAIXA_REMINDER_MAX_AGE_HOURS} h sem lista nova.`,
      action,
    }
  }

  return { ...base, status: "ok", detail: `${summary}.`, action: null }
}

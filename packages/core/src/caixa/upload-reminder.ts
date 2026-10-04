/**
 * Lembrete diário de envio da lista da Caixa à equipe da plataforma.
 *
 * O download automático é bloqueado pelo site da Caixa, então a lista é
 * enviada à mão em `/plataforma/caixa`. Para isso não depender de memória, a
 * rotina diária manda um e-mail quando a última carga tem mais de 24 horas.
 *
 * Sem nenhuma carga anterior, não envia: o lembrete é sobre uma lista que
 * envelheceu, não sobre a primeira carga (que a equipe faz ao ligar o módulo).
 */

/** Tela interna (só equipe da plataforma) onde a lista oficial é enviada. */
export const CAIXA_UPLOAD_PAGE_PATH = "/plataforma/caixa"

/** Idade máxima da última carga antes do lembrete. */
export const CAIXA_REMINDER_MAX_AGE_HOURS = 24

const HOUR_MS = 60 * 60 * 1000

export type CaixaUploadReminderDecision =
  { send: false; reason: "sem_carga_anterior" | "em_dia" } | { send: true; ageHours: number }

/** `syncedAt`: `caixa_catalog_status.sincronizado_em` (fim da última carga). */
export function decideCaixaUploadReminder(
  syncedAt: string | Date | null | undefined,
  now: Date
): CaixaUploadReminderDecision {
  const synced = syncedAt instanceof Date ? syncedAt : syncedAt ? new Date(syncedAt) : null

  if (!synced || Number.isNaN(synced.getTime())) {
    return { send: false, reason: "sem_carga_anterior" }
  }

  const ageMs = now.getTime() - synced.getTime()

  if (ageMs <= CAIXA_REMINDER_MAX_AGE_HOURS * HOUR_MS) {
    return { send: false, reason: "em_dia" }
  }

  return { send: true, ageHours: Math.floor(ageMs / HOUR_MS) }
}

import { z } from "zod"

import { isDateKey, isMonthKey } from "@/lib/agenda/datetime"

export const AGENDA_PATH = "/agenda"

export type AgendaView = {
  /** Dia selecionado ("AAAA-MM-DD"). */
  day: string
  /** Mês exibido no calendário ("AAAA-MM"). */
  month: string
  /** Filtro por corretor (uuid) ou null para todos. */
  broker: string | null
}

type RawSearchParams = Record<string, string | string[] | undefined>

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value
}

/**
 * Lê `dia`, `mes` e `corretor` da URL. Valores inválidos caem no padrão:
 * dia = hoje em Brasília; mês = o do dia; corretor = todos.
 */
export function parseAgendaSearchParams(params: RawSearchParams, todayKey: string): AgendaView {
  const rawDay = first(params.dia)
  const rawMonth = first(params.mes)
  const rawBroker = first(params.corretor)

  const day = isDateKey(rawDay) ? rawDay : todayKey
  const month = isMonthKey(rawMonth) ? rawMonth : day.slice(0, 7)
  const broker = rawBroker && z.guid().safeParse(rawBroker).success ? rawBroker : null

  return { day, month, broker }
}

/** Monta a URL da agenda omitindo o que já é padrão (mês igual ao do dia). */
export function buildAgendaHref({
  day,
  month,
  broker,
}: {
  day?: string | null
  month?: string | null
  broker?: string | null
}) {
  const params = new URLSearchParams()

  if (day) {
    params.set("dia", day)
  }

  if (month && (!day || day.slice(0, 7) !== month)) {
    params.set("mes", month)
  }

  if (broker) {
    params.set("corretor", broker)
  }

  const query = params.toString()

  return query ? `${AGENDA_PATH}?${query}` : AGENDA_PATH
}

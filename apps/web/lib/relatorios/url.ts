import { z } from "zod"

import {
  isReportPeriodPreset,
  resolveReportPeriod,
  type ReportPeriod,
} from "@workspace/core/reports/period"
import { currentMonthKey, isMonthKey, resolveGoalMonth } from "@workspace/core/reports/sales-goals"

export const RELATORIOS_PATH = "/relatorios"

/** Abas da tela. A aba viaja na URL para o link ser compartilhável. */
export const REPORT_TABS = ["corretores", "funil", "origens", "metas", "previsao"] as const

export type ReportTab = (typeof REPORT_TABS)[number]

export const REPORT_TAB_LABELS: Record<ReportTab, string> = {
  corretores: "Por corretor",
  funil: "Funil por etapa",
  origens: "Origem do lead",
  metas: "Metas",
  previsao: "Previsão",
}

/** Abas que leem o período escolhido. Metas usa o mês; Previsão, o mês atual. */
export const PERIOD_TABS: readonly ReportTab[] = ["corretores", "funil", "origens"]

export function tabUsesPeriod(tab: ReportTab) {
  return PERIOD_TABS.includes(tab)
}

export function isReportTab(value: unknown): value is ReportTab {
  return typeof value === "string" && (REPORT_TABS as readonly string[]).includes(value)
}

export type ReportView = {
  period: ReportPeriod
  /** Corretor escolhido no filtro (uuid) ou null para "toda a equipe". */
  broker: string | null
  /** Equipe escolhida no filtro (uuid) ou null para "todas". */
  team: string | null
  /** Mês da aba Metas ("AAAA-MM"). */
  month: string
  tab: ReportTab
}

type RawSearchParams = Record<string, string | string[] | undefined>

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value
}

function guidOrNull(value: string | null | undefined) {
  return value && z.guid().safeParse(value).success ? value : null
}

/**
 * Lê `periodo`, `de`, `ate`, `corretor`, `equipe`, `mes` e `aba` da URL. Valor
 * inválido cai no padrão (últimos 30 dias, toda a equipe, mês atual, aba dos
 * corretores) — nunca derruba a página, e o recorte por papel quem aplica é o
 * banco.
 */
export function parseReportSearchParams(
  params: RawSearchParams,
  now: Date = new Date()
): ReportView {
  const rawTab = first(params.aba)

  return {
    period: resolveReportPeriod(
      { preset: first(params.periodo), from: first(params.de), to: first(params.ate) },
      now
    ),
    broker: guidOrNull(first(params.corretor)),
    team: guidOrNull(first(params.equipe)),
    month: resolveGoalMonth(first(params.mes), now),
    tab: isReportTab(rawTab) ? rawTab : "corretores",
  }
}

/** Equipe e corretor dos parâmetros de uma rota de exportação. */
export function parseReportFilterParams(search: URLSearchParams) {
  return {
    broker: guidOrNull(search.get("corretor")),
    team: guidOrNull(search.get("equipe")),
  }
}

export type ReportHrefInput = {
  preset?: string | null
  from?: string | null
  to?: string | null
  broker?: string | null
  team?: string | null
  month?: string | null
  tab?: ReportTab | null
}

/** Parâmetros do período: o atalho quando há um, as datas quando é à mão. */
export function reportPeriodParams(period: ReportPeriod, target = new URLSearchParams()) {
  if (period.preset) {
    target.set("periodo", period.preset)
  } else {
    target.set("de", period.fromDay)
    target.set("ate", period.toDay)
  }

  return target
}

/** Monta a URL da tela omitindo o que já é padrão. */
export function buildReportHref(input: ReportHrefInput, now: Date = new Date()) {
  const params = new URLSearchParams()

  if (isReportPeriodPreset(input.preset)) {
    if (input.preset !== "30-dias") {
      params.set("periodo", input.preset)
    }
  } else if (input.from && input.to) {
    params.set("de", input.from)
    params.set("ate", input.to)
  }

  if (input.team) {
    params.set("equipe", input.team)
  }

  if (input.broker) {
    params.set("corretor", input.broker)
  }

  if (input.month && isMonthKey(input.month) && input.month !== currentMonthKey(now)) {
    params.set("mes", input.month)
  }

  if (input.tab && input.tab !== "corretores") {
    params.set("aba", input.tab)
  }

  const query = params.toString()

  return query ? `${RELATORIOS_PATH}?${query}` : RELATORIOS_PATH
}

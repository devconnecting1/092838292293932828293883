// Lista completa de corretores do relatório semanal em CSV anexo, quando passa
// do que cabe com segurança no corpo do e-mail (WEEKLY_REPORT_MAX_BROKERS).
// Mesmo formato dos CSV de /relatorios (BOM, `;`, vírgula decimal, sem fórmula).

import { buildCsvDocument, csvFileName } from "../reports/csv"
import { WEEKLY_REPORT_MAX_BROKERS, type WeeklyReportBroker } from "./agenda-templates"
import { isDateKey } from "./reminders"
import { cleanText } from "./sanitize"

/** Trava de tamanho (o banco já limita a 500 linhas; a Brevo aceita anexo de até 256 KB aqui). */
export const WEEKLY_REPORT_CSV_MAX_ROWS = 500

export const WEEKLY_REPORT_CSV_COLUMNS = [
  "Corretor",
  "Situação",
  "Leads recebidos",
  "1º contato (mediana, minutos)",
  "Visitas realizadas",
  "Visitas agendadas",
  "Propostas feitas",
  "Propostas fechadas",
  "Leads ganhos",
] as const

function count(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0
}

export function weeklyReportNeedsCsv(brokers: readonly WeeklyReportBroker[]): boolean {
  return brokers.length > WEEKLY_REPORT_MAX_BROKERS
}

/**
 * Anexo com todos os corretores da semana. null quando a lista cabe no corpo
 * do e-mail ou a semana é inválida.
 */
export function weeklyReportBrokersCsv(params: {
  weekStart: string
  weekEnd: string
  brokers: readonly WeeklyReportBroker[]
}): { name: string; content: string } | null {
  if (
    !weeklyReportNeedsCsv(params.brokers) ||
    !isDateKey(params.weekStart) ||
    !isDateKey(params.weekEnd)
  ) {
    return null
  }

  const rows = params.brokers
    .slice(0, WEEKLY_REPORT_CSV_MAX_ROWS)
    .map((broker) => [
      cleanText(broker.name, { maxLength: 80 }) || "Membro sem nome",
      broker.active === false ? "Inativo" : "Ativo",
      count(broker.leadsReceived),
      typeof broker.firstResponseMedianMinutes === "number" &&
      Number.isFinite(broker.firstResponseMedianMinutes)
        ? Math.max(0, Math.round(broker.firstResponseMedianMinutes))
        : null,
      count(broker.visitsDone),
      count(broker.visitsScheduled),
      count(broker.proposalsMade),
      count(broker.proposalsClosed),
      count(broker.leadsWon),
    ])

  return {
    name: csvFileName("relatorio-semanal-corretores", {
      fromDay: params.weekStart,
      toDay: params.weekEnd,
    }),
    content: buildCsvDocument(WEEKLY_REPORT_CSV_COLUMNS, rows),
  }
}

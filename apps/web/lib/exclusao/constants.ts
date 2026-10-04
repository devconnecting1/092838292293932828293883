/**
 * Exclusão da imobiliária e da própria conta (migração
 * 20260917140155_organization_and_account_deletion). Arquivo puro: serve no
 * servidor e no navegador.
 */

export const ORGANIZATION_SETTINGS_PATH = "/configuracoes/imobiliaria"

/** Âncora do cartão "Excluir a imobiliária" (link do e-mail e do aviso global). */
export const ORGANIZATION_DELETION_ANCHOR = "excluir-imobiliaria"

export const ORGANIZATION_DELETION_HREF = `${ORGANIZATION_SETTINGS_PATH}#${ORGANIZATION_DELETION_ANCHOR}`

export const PROFILE_PATH = "/perfil"

/** Onde estão as planilhas de leads, imóveis, clientes e propostas. */
export const EXPORTS_PATH = "/relatorios"

/** Dias entre o agendamento e a exclusão definitiva (banco: interval '30 days'). */
export const ORGANIZATION_DELETION_DAYS = 30

/** Aviso por e-mail antes da exclusão (banco: list_organization_deletion_reminders). */
export const ORGANIZATION_DELETION_REMINDER_DAYS = 3

/** "17 de outubro de 2026" no horário de Brasília. */
export function formatDeletionDate(value: string | Date) {
  const date = typeof value === "string" ? new Date(value) : value

  if (Number.isNaN(date.getTime())) {
    return "—"
  }

  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "long",
    timeZone: "America/Sao_Paulo",
  }).format(date)
}

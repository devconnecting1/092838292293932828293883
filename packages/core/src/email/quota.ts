// Prioridade dos e-mails da plataforma dentro da cota diária do provedor.
//
// Todos os avisos saem de uma única conta de envio (hoje Brevo Free: 300 por
// dia, campanhas e transacionais — https://www.brevo.com/pricing/). Sem ordem,
// o resumo diário das 07h pode gastar a cota e o aviso de lead novo da tarde
// não sai. Cada tipo de aviso tem uma classe, e cada classe só reserva envio
// enquanto o uso do dia (todas as classes somadas) estiver abaixo do seu teto:
// as classes 1 e 2 podem usar a cota inteira; as demais param antes, deixando
// uma reserva diária para o que não pode esperar.
//
// Função pura: quem conta é o banco (reserve_email_send/settle_email_send), com
// o teto calculado aqui.

export type EmailPriority = 1 | 2 | 3 | 4 | 5 | 6

export const EMAIL_PRIORITY_LABELS: Record<EmailPriority, string> = {
  1: "Lead novo e prazo de 1º contato",
  2: "Convites e acesso à conta",
  3: "Lembretes de visita",
  4: "Cobrança, autorização e outros alertas",
  5: "Resumo diário",
  6: "Relatório semanal",
}

/** Cota da conta Brevo Free. Plano pago: ajuste EMAIL_DAILY_LIMIT. */
export const DEFAULT_EMAIL_DAILY_LIMIT = 300

const MAX_EMAIL_DAILY_LIMIT = 10_000_000

/**
 * Parte da cota diária que cada classe pode ocupar, contando tudo que já saiu
 * no dia (de qualquer classe). Com 300/dia: 300, 300, 225, 210, 150 e 120 — o
 * resumo diário e o relatório semanal nunca consomem a cota inteira, e sobra
 * pelo menos um quarto (75 envios) só para lead novo, prazo e convites.
 */
export const EMAIL_PRIORITY_SHARE: Record<EmailPriority, number> = {
  1: 1,
  2: 1,
  3: 0.75,
  4: 0.7,
  5: 0.5,
  6: 0.4,
}

/**
 * Classe de cada tipo de aviso (nomes de NotificationKind e dos envios diretos
 * do Console). Tipo desconhecido cai na classe 4: nunca come a reserva de lead.
 */
export const EMAIL_KIND_PRIORITY: Readonly<Record<string, EmailPriority>> = {
  new_lead: 1,
  lead_sla_notice: 1,
  capture_request: 1,
  team_invitation: 2,
  platform_team_invitation: 2,
  account_access: 2,
  organization_deletion: 2,
  visit_reminder: 3,
  visit_assigned: 3,
  subscription_notice: 4,
  authorization_expiring: 4,
  ai_quota_notice: 4,
  referral_notice: 4,
  status_alert: 4,
  caixa_reminder: 4,
  platform_team_notice: 4,
  daily_digest: 5,
  weekly_report: 6,
}

export const EMAIL_UNKNOWN_KIND_PRIORITY: EmailPriority = 4

export function emailPriorityForKind(kind: string): EmailPriority {
  return Object.prototype.hasOwnProperty.call(EMAIL_KIND_PRIORITY, kind)
    ? (EMAIL_KIND_PRIORITY[kind] as EmailPriority)
    : EMAIL_UNKNOWN_KIND_PRIORITY
}

/** EMAIL_DAILY_LIMIT: inteiro positivo; vazio ou inválido usa o padrão (300). */
export function parseEmailDailyLimit(raw: string | null | undefined): number {
  const text = raw?.trim()

  if (!text || !/^\d{1,8}$/.test(text)) {
    return DEFAULT_EMAIL_DAILY_LIMIT
  }

  const value = Number.parseInt(text, 10)

  return value >= 1 ? Math.min(value, MAX_EMAIL_DAILY_LIMIT) : DEFAULT_EMAIL_DAILY_LIMIT
}

/**
 * Uso do dia (envios de todas as classes) até o qual esta classe ainda pode
 * reservar: reserva quando `usado < teto`. Nunca abaixo de 1 para as classes 1
 * e 2, e nunca acima do limite diário.
 */
export function emailPriorityCeiling(dailyLimit: number, priority: EmailPriority): number {
  const limit =
    Number.isFinite(dailyLimit) && dailyLimit >= 1
      ? Math.min(Math.floor(dailyLimit), MAX_EMAIL_DAILY_LIMIT)
      : DEFAULT_EMAIL_DAILY_LIMIT
  const ceiling = Math.floor(limit * EMAIL_PRIORITY_SHARE[priority])

  return priority <= 2 ? Math.max(1, Math.min(limit, ceiling)) : Math.min(limit, ceiling)
}

/** Envios que ficam guardados só para as classes 1 e 2 (lead e convites). */
export function emailDailyReserve(dailyLimit: number): number {
  return emailPriorityCeiling(dailyLimit, 1) - emailPriorityCeiling(dailyLimit, 3)
}

/**
 * Sem o contador (banco fora do ar ou chave ausente): lead, convite, lembrete e
 * alertas seguem (o provedor ainda recusa acima da cota, com 402/429); resumo e
 * relatório esperam, porque são os que esgotariam a cota às cegas.
 */
export function emailSendsWithoutCounter(priority: EmailPriority): boolean {
  return priority <= 4
}

export type EmailQuotaUsage = {
  priority: EmailPriority
  reserved: number
  sent: number
  failed: number
  denied: number
}

/** Resumo do dia para o Console: uso somado, livre e o teto de cada classe. */
export function summarizeEmailQuota(dailyLimit: number, rows: readonly EmailQuotaUsage[]) {
  const used = rows.reduce((total, row) => total + row.reserved + row.sent, 0)
  const limit = emailPriorityCeiling(dailyLimit, 1)

  return {
    limit,
    used,
    free: Math.max(0, limit - used),
    reserve: emailDailyReserve(dailyLimit),
    denied: rows.reduce((total, row) => total + row.denied, 0),
    failed: rows.reduce((total, row) => total + row.failed, 0),
    /** Classes que já não reservam mais hoje (uso chegou ao teto). */
    blocked: ([1, 2, 3, 4, 5, 6] as const).filter(
      (priority) => used >= emailPriorityCeiling(dailyLimit, priority)
    ),
  }
}

const UNDELIVERED_KIND_LABELS: Readonly<Record<string, string>> = {
  new_lead: "Aviso de lead novo",
  lead_sla_notice: "Prazo de 1º contato",
  capture_request: "Pedido de captação",
  team_invitation: "Convite de equipe",
  platform_team_invitation: "Convite da equipe da plataforma",
  organization_deletion: "Exclusão da imobiliária",
  visit_reminder: "Lembrete de visita",
  visit_assigned: "Visita marcada",
  subscription_notice: "Aviso de assinatura",
  authorization_expiring: "Autorização vencendo",
  ai_quota_notice: "Franquia de IA",
  referral_notice: "Indicação",
  status_alert: "Alerta de status",
  caixa_reminder: "Lembrete da Caixa",
  platform_team_notice: "Aviso da equipe da plataforma",
  daily_digest: "Resumo diário",
  weekly_report: "Relatório semanal",
}

export function emailKindLabel(kind: string): string {
  return Object.prototype.hasOwnProperty.call(UNDELIVERED_KIND_LABELS, kind)
    ? (UNDELIVERED_KIND_LABELS[kind] as string)
    : "Outro aviso"
}

const UNDELIVERED_REASON_LABELS: Readonly<Record<string, string>> = {
  daily_quota: "cota diária de e-mails acabou",
  rate_limited: "limite do provedor de e-mail",
  not_configured: "envio de e-mail não configurado",
  invalid_recipient: "endereço de e-mail inválido",
  provider_error: "falha no provedor de e-mail",
}

export function emailFailureLabel(reason: string): string {
  return Object.prototype.hasOwnProperty.call(UNDELIVERED_REASON_LABELS, reason)
    ? (UNDELIVERED_REASON_LABELS[reason] as string)
    : "falha no envio"
}

/** Motivos que o banco aceita ao marcar um aviso como não enviado depois de tentar. */
const SETTLE_REASONS = new Set([
  "rate_limited",
  "not_configured",
  "invalid_recipient",
  "provider_error",
])

export type EmailQuotaReservation =
  | { status: "reserved"; day: string }
  /** Uso do dia chegou ao teto da classe: o banco já marcou o aviso como não enviado. */
  | { status: "denied" }
  /** Contador fora do ar (chave ausente, banco recusou ou erro de rede). */
  | { status: "unavailable" }

export type QuotaGuardedSend<T extends { ok: boolean }> = {
  /** Tipo do aviso (NotificationKind ou envio direto do Console). */
  kind: string
  dailyLimit: number
  reserve: (request: { priority: EmailPriority; ceiling: number }) => Promise<EmailQuotaReservation>
  send: () => Promise<T>
  /** Nunca deve lançar; se lançar, o resultado do envio continua valendo. */
  settle: (request: {
    day: string
    priority: EmailPriority
    sent: boolean
    reason: string | null
  }) => Promise<void>
}

/**
 * Reserva na cota do dia, envia e confirma. Negado pela cota (ou contador fora
 * do ar para resumo e relatório): não envia e devolve `daily_quota`. Todo envio
 * reservado é confirmado — enviado ou devolvido com o motivo da falha.
 */
export async function sendWithinEmailQuota<T extends { ok: boolean; reason?: string }>(
  input: QuotaGuardedSend<T>
): Promise<T | { ok: false; reason: "daily_quota" }> {
  const priority = emailPriorityForKind(input.kind)
  const ceiling = emailPriorityCeiling(input.dailyLimit, priority)
  let reservation: EmailQuotaReservation

  try {
    reservation = await input.reserve({ priority, ceiling })
  } catch {
    reservation = { status: "unavailable" }
  }

  if (
    reservation.status === "denied" ||
    (reservation.status === "unavailable" && !emailSendsWithoutCounter(priority))
  ) {
    return { ok: false, reason: "daily_quota" }
  }

  let result: T | null = null

  try {
    result = await input.send()
    return result
  } finally {
    if (reservation.status === "reserved") {
      const reason = result?.ok ? null : (result?.reason ?? "provider_error")

      try {
        await input.settle({
          day: reservation.day,
          priority,
          sent: result?.ok === true,
          reason: reason === null ? null : SETTLE_REASONS.has(reason) ? reason : "provider_error",
        })
      } catch {
        // Confirmação perdida: a reserva fica contada no dia (lado seguro).
      }
    }
  }
}

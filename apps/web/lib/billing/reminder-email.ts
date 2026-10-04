import "server-only"

import type { BillingReminderKind, BillingReminderRow } from "@/lib/billing/rpc"
import {
  sendNotificationEmail,
  type NotificationSummary,
  type SubscriptionNoticeNotification,
} from "@/lib/email"

/**
 * Avisos de assinatura do cron diário, enviados pelo módulo de e-mail (modelo
 * "aviso de assinatura"). O módulo nunca lança e deduplica cada envio pela
 * chave de idempotência (tipo, imobiliária, data e destinatário).
 */

const NOTICE_BY_KIND: Record<BillingReminderKind, SubscriptionNoticeNotification["notice"]> = {
  trial_ending_3d: "trial_ending",
  trial_ending_1d: "trial_ending",
  past_due: "payment_failed",
  read_only_today: "read_only",
}

const DAY_MS = 24 * 60 * 60 * 1000

/** Só defesa: o banco devolve notice_date; sem ela, estima pela regra do aviso. */
function fallbackNoticeDate(kind: BillingReminderKind): Date | null {
  switch (kind) {
    case "trial_ending_3d":
      return new Date(Date.now() + 3 * DAY_MS)
    case "trial_ending_1d":
      return new Date(Date.now() + DAY_MS)
    case "read_only_today":
      return new Date()
    case "past_due":
      return null
  }
}

export async function sendBillingReminderEmail(
  kind: BillingReminderKind,
  reminder: BillingReminderRow,
  recipients: readonly string[]
): Promise<NotificationSummary> {
  return sendNotificationEmail("subscription_notice", {
    organizationSlug: reminder.organizationSlug,
    organizationName: reminder.organizationName,
    notice: NOTICE_BY_KIND[kind],
    to: recipients.map((email) => ({ email })),
    date: reminder.noticeDate ?? fallbackNoticeDate(kind),
  })
}

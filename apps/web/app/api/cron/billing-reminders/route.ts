import { createHash, timingSafeEqual } from "node:crypto"

import { describeBillingError } from "@/lib/billing/errors"
import { runReferralCronPasses, sendReferralNotice } from "@/lib/billing/referrals"
import { sendBillingReminderEmail } from "@/lib/billing/reminder-email"
import {
  BILLING_REMINDER_KINDS,
  listBillingReminders,
  type BillingReminderKind,
  type BillingReminderRow,
} from "@/lib/billing/rpc"
import { isValidTenantSlug } from "@/lib/tenant/urls"

/**
 * Avisos diários de assinatura (Vercel Cron, 1x/dia no plano Hobby): teste
 * acabando em 3 e 1 dia, pagamento em atraso e entrada no modo leitura. Envia
 * aos donos de cada imobiliária pelo módulo de e-mail, com limite de
 * destinatários por execução. Também roda as passadas do Indique e ganhe
 * (carências completadas e reconciliação diária); os avisos de indicação usam o
 * saldo do mesmo limite. Autorização: `Authorization: Bearer ${CRON_SECRET}`
 * (comparação em tempo constante). Logs e resposta só com contagens.
 */

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/** Destinatários por execução, somando avisos de assinatura e de indicação (Brevo Free: 300/dia). */
const MAX_RECIPIENTS_PER_RUN = 200

type KindSummary = {
  kind: BillingReminderKind
  organizations: number
  attempted: number
  sent: number
  failed: number
  skipped: number
  error: boolean
}

function reply(status: number, body: Record<string, unknown>) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } })
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest()
}

/** Compara os hashes (mesmo tamanho) para não vazar o segredo pelo tempo de resposta. */
function isAuthorized(header: string | null, secret: string) {
  return timingSafeEqual(sha256(header ?? ""), sha256(`Bearer ${secret}`))
}

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET?.trim()

  if (!secret) {
    console.error("CRON_SECRET ausente")
    return reply(500, { error: "not_configured" })
  }

  if (!isAuthorized(request.headers.get("authorization"), secret)) {
    return reply(401, { error: "unauthorized" })
  }

  let budget = MAX_RECIPIENTS_PER_RUN
  let truncated = false
  const summaries: KindSummary[] = []

  for (const kind of BILLING_REMINDER_KINDS) {
    if (truncated) {
      break
    }

    const summary: KindSummary = {
      kind,
      organizations: 0,
      attempted: 0,
      sent: 0,
      failed: 0,
      skipped: 0,
      error: false,
    }
    summaries.push(summary)

    let reminders: BillingReminderRow[]

    try {
      reminders = await listBillingReminders(kind)
    } catch (error) {
      summary.error = true
      console.error(`[billing/cron] ${kind}: leitura falhou (${describeBillingError(error)})`)
      continue
    }

    summary.organizations = reminders.length

    for (const reminder of reminders) {
      if (!isValidTenantSlug(reminder.organizationSlug) || reminder.ownerEmails.length === 0) {
        continue
      }

      if (budget === 0) {
        truncated = true
        break
      }

      const recipients = reminder.ownerEmails.slice(0, budget)
      budget -= recipients.length

      const result = await sendBillingReminderEmail(kind, reminder, recipients)
      summary.attempted += result.attempted
      summary.sent += result.sent
      summary.failed += result.failed
      summary.skipped += result.skipped
    }
  }

  if (truncated) {
    console.error(
      `[billing/cron] limite de ${MAX_RECIPIENTS_PER_RUN} destinatários por execução atingido`
    )
  }

  // Indique e ganhe (o plano Hobby da Vercel só permite cron diário, então as
  // passadas ficam neste mesmo cron). Os avisos respeitam o saldo do limite.
  const referrals = await runReferralCronPasses()
  const referralEmails = { attempted: 0, sent: 0, failed: 0, truncated: false }

  for (const notice of referrals.notices) {
    if (budget <= 0) {
      referralEmails.truncated = true
      break
    }

    const result = await sendReferralNotice(notice, { maxRecipients: budget })

    if (!result) {
      continue
    }

    budget -= result.attempted
    referralEmails.attempted += result.attempted
    referralEmails.sent += result.sent
    referralEmails.failed += result.failed
  }

  if (
    referralEmails.truncated ||
    referrals.summary.truncated.grace ||
    referrals.summary.truncated.reconcile
  ) {
    console.error(
      `[billing/cron] indicações com limite por execução atingido (e-mails: ${referralEmails.truncated}, carências: ${referrals.summary.truncated.grace}, reconciliação: ${referrals.summary.truncated.reconcile})`
    )
  }

  return reply(200, {
    ok: true,
    truncated,
    kinds: summaries,
    referrals: { ...referrals.summary, emails: referralEmails },
  })
}

import { createHash, timingSafeEqual } from "node:crypto"

import { sendNotificationEmail } from "@/lib/email"
import {
  claimAuthorizationAlerts,
  settleAuthorizationAlerts,
  type AuthorizationAlert,
} from "@/lib/imoveis/authorization-alert-queue"
import { isValidTenantSlug } from "@/lib/tenant/urls"

/**
 * Avisos de autorização de venda/locação vencendo (Vercel Cron, 1x/dia no plano
 * Hobby). O banco enfileira o marco do dia de cada imóvel em carteira (30, 15, 7
 * ou 1 dia antes do fim) para o captador, o corretor e os donos e gerentes, e a
 * chave única da fila garante um aviso por marco. Aqui os avisos reservados são
 * agrupados em UM e-mail por pessoa e imobiliária, para caber na cota diária.
 *
 * Autorização: `Authorization: Bearer ${CRON_SECRET}` (comparação em tempo
 * constante). Resposta e logs só com contagens.
 */

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * E-mails por execução. A conta Brevo Free envia 300/dia e já divide a cota com
 * os avisos de assinatura e de lead; o que passar daqui volta para a fila e sai
 * no dia seguinte (o marco de 30 dias dura duas semanas).
 */
const MAX_EMAILS_PER_RUN = 60

/** Avisos reservados por execução (um por imóvel, marco e pessoa). */
const CLAIM_SIZE = 300

type RunSummary = {
  claimed: number
  emails: number
  sent: number
  failed: number
  released: number
  invalidSlug: number
  /** Sobrou gente sem e-mail nesta execução (limite atingido). */
  truncated: boolean
  /** Parou no meio: e-mail sem configuração ou cota diária estourada. */
  halted: boolean
  settled: { sent: number; failed: number; released: number }
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

/** Um grupo = um e-mail: mesma imobiliária e mesma pessoa. */
function groupByRecipient(alerts: readonly AuthorizationAlert[]) {
  const groups = new Map<string, AuthorizationAlert[]>()

  for (const alert of alerts) {
    const key = `${alert.organizationId}:${alert.recipientUserId}`
    const group = groups.get(key)

    if (group) {
      group.push(alert)
    } else {
      groups.set(key, [alert])
    }
  }

  return [...groups.values()]
}

async function sendGroup(group: readonly AuthorizationAlert[]) {
  const [first] = group

  if (!first) {
    return null
  }

  // Um imóvel aparece uma vez por e-mail, mesmo que a fila tenha dois avisos dele.
  const byProperty = new Map<string, AuthorizationAlert>()

  for (const alert of group) {
    const current = byProperty.get(alert.propertyId)

    if (!current || alert.daysLeft < current.daysLeft) {
      byProperty.set(alert.propertyId, alert)
    }
  }

  return sendNotificationEmail("authorization_expiring", {
    organizationSlug: first.organizationSlug,
    alertIds: group.map((alert) => alert.id),
    to: { email: first.recipientEmail, name: first.recipientName },
    isManager: first.recipientIsManager,
    brand: { name: first.organizationName || null, primaryColor: first.brandColor },
    items: [...byProperty.values()].map((alert) => ({
      propertyId: alert.propertyId,
      code: alert.propertyCode,
      title: alert.propertyTitle,
      neighborhood: alert.propertyNeighborhood,
      city: alert.propertyCity,
      endsOn: alert.endsOn,
      daysLeft: alert.daysLeft,
      exclusive: alert.exclusive,
    })),
  })
}

async function run(): Promise<RunSummary> {
  const alerts = await claimAuthorizationAlerts(CLAIM_SIZE)
  const summary: RunSummary = {
    claimed: alerts.length,
    emails: 0,
    sent: 0,
    failed: 0,
    released: 0,
    invalidSlug: 0,
    truncated: false,
    halted: false,
    settled: { sent: 0, failed: 0, released: 0 },
  }

  if (alerts.length === 0) {
    return summary
  }

  const sent: string[] = []
  const failed: string[] = []
  const released: string[] = []

  try {
    for (const group of groupByRecipient(alerts)) {
      const ids = group.map((alert) => alert.id)

      if (summary.halted || summary.emails >= MAX_EMAILS_PER_RUN) {
        summary.truncated = summary.truncated || !summary.halted
        released.push(...ids)
        continue
      }

      if (!isValidTenantSlug(group[0]?.organizationSlug ?? "")) {
        summary.invalidSlug += 1
        failed.push(...ids)
        continue
      }

      summary.emails += 1
      const result = await sendGroup(group)

      if (result && result.sent > 0) {
        sent.push(...ids)
        continue
      }

      // Cota diária da plataforma: nem tentou, volta sem gastar tentativa.
      if (result?.reasons.daily_quota) {
        released.push(...ids)
        summary.halted = true
        continue
      }

      failed.push(...ids)

      if (result?.reasons.not_configured || result?.reasons.rate_limited) {
        summary.halted = true
      }
    }
  } finally {
    // Todo aviso reservado volta ao banco: enviado, falhou (conta tentativa) ou
    // nem foi tentado (não conta).
    const accounted = new Set([...sent, ...failed, ...released])
    const leftovers = alerts.map((alert) => alert.id).filter((id) => !accounted.has(id))

    summary.settled = await settleAuthorizationAlerts({
      sent,
      failed,
      released: [...released, ...leftovers],
    })
    summary.sent = sent.length
    summary.failed = failed.length
    summary.released = released.length + leftovers.length
  }

  return summary
}

async function handle(request: Request) {
  const secret = process.env.CRON_SECRET?.trim()

  if (!secret) {
    console.error("CRON_SECRET ausente")
    return reply(500, { error: "not_configured" })
  }

  if (!isAuthorized(request.headers.get("authorization"), secret)) {
    return reply(401, { error: "unauthorized" })
  }

  const summary = await run()
  const line = `[imoveis/autorizacao] ${summary.sent}/${summary.claimed} aviso(s) enviado(s) em ${summary.emails} e-mail(s), ${summary.failed} devolvido(s), ${summary.released} para a próxima execução`

  if (summary.failed > 0 || summary.invalidSlug > 0 || summary.truncated || summary.halted) {
    console.error(
      `${line}${summary.truncated ? " (limite por execução atingido)" : ""}${summary.halted ? " (envio interrompido: configuração ou cota)" : ""}`
    )
  } else {
    console.info(line)
  }

  return reply(200, { ok: true, ...summary })
}

export async function GET(request: Request) {
  return handle(request)
}

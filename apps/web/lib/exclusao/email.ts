import "server-only"

import { cleanText, isUuid, normalizeEmailAddress } from "@workspace/core/email/sanitize"
import {
  organizationDeletionEmail,
  type OrganizationDeletionNoticeKind,
} from "@workspace/core/email/organization-deletion-templates"

import { getEmailProvider } from "@/lib/email"
import { deriveIdempotencyKey } from "@/lib/email/idempotency"
import { buildTenantOrigin, isValidTenantSlug } from "@/lib/tenant/urls"

export type OrganizationDeletionNotice = {
  organizationId: string
  organizationSlug: string
  organizationName: string
  brandColor: string | null
  executeAfter: string
  recipients: readonly string[]
}

export type OrganizationDeletionNoticeSummary = { attempted: number; sent: number; failed: number }

/** Donos por aviso (defesa: o banco devolve só os donos ativos). */
const MAX_RECIPIENTS = 10

/**
 * Aviso aos donos no agendamento e 3 dias antes da exclusão, pelo provedor de
 * e-mail do app (Brevo ou simulado). Nunca lança; logs só com contagens.
 * O mesmo aviso repetido não duplica: a chave de idempotência junta o tipo, a
 * imobiliária, a data da exclusão e o destinatário.
 */
export async function sendOrganizationDeletionNotice(
  kind: OrganizationDeletionNoticeKind,
  notice: OrganizationDeletionNotice
): Promise<OrganizationDeletionNoticeSummary> {
  const summary: OrganizationDeletionNoticeSummary = { attempted: 0, sent: 0, failed: 0 }

  if (!isUuid(notice.organizationId) || !isValidTenantSlug(notice.organizationSlug)) {
    console.error(`[exclusao] aviso ${kind}: imobiliária inválida`)
    return summary
  }

  const recipients = [
    ...new Set(notice.recipients.map((email) => normalizeEmailAddress(email)).filter(Boolean)),
  ].slice(0, MAX_RECIPIENTS) as string[]

  if (recipients.length === 0) {
    return summary
  }

  try {
    const provider = getEmailProvider()
    const email = organizationDeletionEmail({
      origin: buildTenantOrigin(notice.organizationSlug),
      brand: {
        name: cleanText(notice.organizationName, { maxLength: 80 }),
        primaryColor: notice.brandColor,
      },
      kind,
      organizationName: notice.organizationName,
      executeAfter: notice.executeAfter,
    })

    for (const recipient of recipients) {
      summary.attempted += 1
      const result = await provider.send({
        to: { email: recipient },
        subject: email.subject,
        html: email.html,
        text: email.text,
        tags: ["crm", `organization_deletion_${kind}`],
        quota: { kind: "organization_deletion", organizationSlug: notice.organizationSlug },
        idempotencyKey: deriveIdempotencyKey(
          "organization_deletion",
          kind,
          notice.organizationId,
          notice.executeAfter,
          recipient
        ),
      })

      if (result.ok) {
        summary.sent += 1
      } else {
        summary.failed += 1

        if (result.reason === "not_configured" || result.reason === "rate_limited") {
          break
        }
      }
    }
  } catch (cause) {
    console.error(
      `[exclusao] aviso ${kind}: falha ao preparar (${cause instanceof Error ? cause.name : "erro"})`
    )
    summary.failed += 1
  }

  const line = `[exclusao] aviso ${kind}: ${summary.sent}/${summary.attempted} enviado(s)`

  if (summary.failed > 0) {
    console.error(line)
  } else {
    console.info(line)
  }

  return summary
}

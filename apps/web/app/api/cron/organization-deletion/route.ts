import { createHash, timingSafeEqual } from "node:crypto"

import { sendOrganizationDeletionNotice } from "@/lib/exclusao/email"
import {
  listOrganizationDeletionReminders,
  markOrganizationDeletionReminded,
  purgeDeletedOrganizationsStorage,
} from "@/lib/exclusao/server-rpc"

/**
 * Exclusão de imobiliária (Vercel Cron, 1x/dia no plano Hobby, depois do pg_cron
 * imobiliaria-exclusao-diaria das 06:41 UTC):
 *
 * 1. Aviso aos donos 3 dias antes da exclusão definitiva (uma vez por
 *    agendamento; marcado só depois de pelo menos um envio aceito).
 * 2. Arquivos do Storage das imobiliárias já apagadas: o banco não apaga
 *    arquivo e o projeto não usa service_role. O banco reserva um lote de
 *    caminhos (chave ORGANIZATION_DELETION_SERVER_KEY) e a Storage API remove
 *    com a chave publishable, pelas políticas anon que valem só para caminho
 *    reservado de imobiliária inexistente. O que não couber sai no dia seguinte.
 *
 * Autorização: `Authorization: Bearer ${CRON_SECRET}` (comparação em tempo
 * constante). Resposta e logs só com contagens.
 */

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/** Avisos por execução (divide a cota diária da Brevo com os demais avisos). */
const MAX_REMINDERS_PER_RUN = 30

/** Arquivos por execução: cada remove leva até 100; 1.000 cabe no tempo da função. */
const STORAGE_BATCH = 1000

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

  const reminders = { organizations: 0, attempted: 0, sent: 0, failed: 0, error: false }
  const due = await listOrganizationDeletionReminders(MAX_REMINDERS_PER_RUN)

  if (due === null) {
    reminders.error = true
  } else {
    reminders.organizations = due.length

    for (const notice of due) {
      const result = await sendOrganizationDeletionNotice("reminder", notice)
      reminders.attempted += result.attempted
      reminders.sent += result.sent
      reminders.failed += result.failed

      if (result.sent > 0) {
        await markOrganizationDeletionReminded(notice.organizationId)
      }
    }
  }

  const storage = await purgeDeletedOrganizationsStorage(STORAGE_BATCH)

  if (storage.error || storage.failedBatches > 0) {
    console.error(
      `[exclusao/cron] Storage: ${storage.removed}/${storage.claimed} removidos, ${storage.failedBatches} lote(s) com falha`
    )
  }

  return reply(200, { ok: true, reminders, storage })
}

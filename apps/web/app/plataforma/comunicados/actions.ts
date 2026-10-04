"use server"

import { revalidatePath } from "next/cache"

import {
  prepareAnnouncement,
  prepareAnnouncementEndReason,
  type AnnouncementField,
} from "@workspace/core/platform/announcements"
import { PLATFORM_READ_ONLY_MESSAGE } from "@workspace/core/platform/staff"

import { canAct, getPlatformAdmin } from "@/lib/plataforma/admin"
import {
  announcementFailureMessage,
  endPlatformAnnouncement,
  PLATFORM_ANNOUNCEMENTS_PATH,
  savePlatformAnnouncement,
} from "@/lib/plataforma/comunicados"
import { PLATFORM_RPC_FAILURE_MESSAGES } from "@/lib/plataforma/rpc"

/**
 * Server Actions dos comunicados. Cada uma confere de novo a pessoa da equipe e
 * o papel ("Somente leitura" não age; a RPC confere mais uma vez) e valida tudo
 * no servidor: o que vem do navegador nunca é confiável. Quem agiu vem da sessão, e o registro do console é gravado
 * pela própria RPC na mesma transação.
 */

export type AnnouncementActionResult =
  | { ok: true; message: string }
  | { ok: false; error: string; fieldErrors?: Partial<Record<AnnouncementField, string>> }

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** null = pode agir; senão a mensagem de recusa. */
async function denyUnlessCanAct(): Promise<string | null> {
  const admin = await getPlatformAdmin()

  if (!admin) {
    return PLATFORM_RPC_FAILURE_MESSAGES.sem_acesso
  }

  return canAct(admin) ? null : PLATFORM_READ_ONLY_MESSAGE
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

export async function saveAnnouncementAction(
  values: unknown,
  id: string | null
): Promise<AnnouncementActionResult> {
  const denied = await denyUnlessCanAct()

  if (denied) {
    return { ok: false, error: denied }
  }

  if (id !== null && (typeof id !== "string" || !UUID_PATTERN.test(id))) {
    return { ok: false, error: "Comunicado inválido. Atualize a página." }
  }

  const prepared = prepareAnnouncement(isRecord(values) ? values : {}, new Date())

  if (!prepared.ok) {
    return {
      ok: false,
      error: "Confira os campos destacados.",
      fieldErrors: prepared.fieldErrors,
    }
  }

  const result = await savePlatformAnnouncement(prepared.payload, id)

  if (!result.ok) {
    return { ok: false, error: announcementFailureMessage(result) }
  }

  revalidatePath(PLATFORM_ANNOUNCEMENTS_PATH)

  return {
    ok: true,
    message: id ? "Comunicado atualizado." : "Comunicado criado.",
  }
}

export async function endAnnouncementAction(
  id: string,
  reason: unknown
): Promise<AnnouncementActionResult> {
  const denied = await denyUnlessCanAct()

  if (denied) {
    return { ok: false, error: denied }
  }

  if (typeof id !== "string" || !UUID_PATTERN.test(id)) {
    return { ok: false, error: "Comunicado inválido. Atualize a página." }
  }

  const preparedReason = prepareAnnouncementEndReason(reason)

  if (!preparedReason.ok) {
    return { ok: false, error: preparedReason.error }
  }

  const result = await endPlatformAnnouncement(id, preparedReason.reason)

  if (!result.ok) {
    return { ok: false, error: announcementFailureMessage(result) }
  }

  revalidatePath(PLATFORM_ANNOUNCEMENTS_PATH)

  return { ok: true, message: "Comunicado encerrado: saiu do ar para todo mundo." }
}

import "server-only"

import { createClient } from "@supabase/supabase-js"
import { z } from "zod"

import { cleanText, isUuid, normalizeEmailAddress } from "@workspace/core/email/sanitize"

import { getSupabaseEnv } from "@/lib/supabase/env"

export type RecipientNotificationKind = "new_lead" | "capture_request"

export type NotificationRecipient = { email: string; fullName: string | null }

const rowsSchema = z.array(z.object({ email: z.string(), full_name: z.string().nullable() }))

export type NotificationRecipientsQuery = {
  kind: RecipientNotificationKind
  /** new_lead: leads.id ou o event_id enviado a submit_landing_lead; capture_request: capture_requests.id */
  subjectId: string
  /** Opcional: sem ela, o banco usa a imobiliária do próprio registro. */
  organizationId?: string | null
}

/**
 * Quem avisar sobre um lead ou captação que chegou sem sessão (formulário público).
 * RPC get_notification_recipients com a chave publishable e NOTIFICATION_SERVER_KEY
 * (segredo notification_server_key do Vault). Nunca lança; em falha devolve [] e
 * registra só o código do erro.
 */
export async function getNotificationRecipients(
  query: NotificationRecipientsQuery
): Promise<NotificationRecipient[]> {
  const serverKey = process.env.NOTIFICATION_SERVER_KEY?.trim()

  if (!serverKey) {
    console.error("NOTIFICATION_SERVER_KEY ausente")
    return []
  }

  if (!isUuid(query.subjectId) || (query.organizationId && !isUuid(query.organizationId))) {
    console.error("[email] destinatários: identificador inválido")
    return []
  }

  const env = getSupabaseEnv()

  if (!env) {
    console.error("[email] destinatários: Supabase não configurado")
    return []
  }

  try {
    // Sem o tipo Database de propósito: a RPC entra em @workspace/database/types
    // na próxima regeneração; o retorno é validado com zod.
    const supabase = createClient(env.url, env.publishableKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    })
    const { data, error } = await supabase.rpc("get_notification_recipients", {
      p_server_key: serverKey,
      p_organization_id: query.organizationId ?? null,
      p_kind: query.kind,
      p_subject_id: query.subjectId,
    })

    if (error) {
      console.error(
        `[email] get_notification_recipients falhou (código ${error.code || "desconhecido"})`
      )
      return []
    }

    const parsed = rowsSchema.safeParse(data)

    if (!parsed.success) {
      console.error("[email] get_notification_recipients: resposta inesperada")
      return []
    }

    const seen = new Set<string>()

    return parsed.data.flatMap((row) => {
      const email = normalizeEmailAddress(row.email)

      if (!email || seen.has(email)) {
        return []
      }

      seen.add(email)
      return [{ email, fullName: cleanText(row.full_name, { maxLength: 120 }) || null }]
    })
  } catch (cause) {
    console.error(
      `[email] get_notification_recipients falhou (${cause instanceof Error ? cause.name : "erro"})`
    )
    return []
  }
}

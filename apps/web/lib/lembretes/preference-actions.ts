"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"

import type { TablesInsert } from "@workspace/database/types"

import type { ActionResult } from "@/lib/auth/action-result"
import { requireUser } from "@/lib/auth/session"
import { EMAIL_PREFERENCE_KEYS, type EmailPreferenceKey } from "@/lib/lembretes/preferences"
import { createClient } from "@/lib/supabase/server"

const preferenceSchema = z.object({
  key: z.enum(EMAIL_PREFERENCE_KEYS),
  enabled: z.boolean(),
})

const SUCCESS_MESSAGES = {
  daily_digest: ["Resumo diário ligado.", "Resumo diário desligado."],
  visit_reminders: ["Lembretes de visita ligados.", "Lembretes de visita desligados."],
  visit_assigned: ["Aviso de visita marcada ligado.", "Aviso de visita marcada desligado."],
  task_reminders: ["Lembrete de tarefa ligado.", "Lembrete de tarefa desligado."],
  weekly_report: ["Relatório semanal ligado.", "Relatório semanal desligado."],
} as const satisfies Record<EmailPreferenceKey, readonly [string, string]>

/** Liga ou desliga um e-mail automático da própria pessoa (upsert; RLS: só a própria linha). */
export async function setEmailPreference(values: {
  key: string
  enabled: boolean
}): Promise<ActionResult> {
  const parsed = preferenceSchema.safeParse(values)

  if (!parsed.success) {
    return { ok: false, error: "Preferência inválida." }
  }

  const { key, enabled } = parsed.data
  const user = await requireUser()
  const supabase = await createClient()
  const row: TablesInsert<"email_preferences"> = { user_id: user.id, [key]: enabled }
  // Só a coluna enviada muda; numa linha nova as outras ficam ligadas (padrão).
  const { error } = await supabase.from("email_preferences").upsert(row, { onConflict: "user_id" })

  if (error) {
    console.error(
      `[perfil/e-mails] falha ao salvar a preferência (código ${error.code || "desconhecido"})`
    )
    return { ok: false, error: "Não foi possível salvar agora. Tente de novo." }
  }

  revalidatePath("/perfil")

  const [on, off] = SUCCESS_MESSAGES[key]
  return { ok: true, message: enabled ? on : off }
}

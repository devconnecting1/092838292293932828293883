import "server-only"

import { createClient } from "@/lib/supabase/server"

/**
 * Preferências dos e-mails e avisos automáticos da pessoa (public.email_preferences).
 * Sem linha no banco = tudo ligado. Lido com a sessão: o RLS só deixa ver as
 * próprias.
 */

export const EMAIL_PREFERENCE_KEYS = [
  "daily_digest",
  "visit_reminders",
  "visit_assigned",
  "task_reminders",
  "weekly_report",
] as const

export type EmailPreferenceKey = (typeof EMAIL_PREFERENCE_KEYS)[number]

export type EmailPreferences = Record<EmailPreferenceKey, boolean>

export const DEFAULT_EMAIL_PREFERENCES: EmailPreferences = {
  daily_digest: true,
  visit_reminders: true,
  visit_assigned: true,
  task_reminders: true,
  weekly_report: true,
}

/** null = não carregou (a tela avisa em vez de mostrar tudo ligado). */
export async function getEmailPreferences(userId: string): Promise<EmailPreferences | null> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from("email_preferences")
    .select("daily_digest, visit_reminders, visit_assigned, task_reminders, weekly_report")
    .eq("user_id", userId)
    .maybeSingle()

  if (error) {
    console.error(
      `[perfil/e-mails] falha ao carregar as preferências (código ${error.code || "desconhecido"})`
    )
    return null
  }

  return data ?? DEFAULT_EMAIL_PREFERENCES
}

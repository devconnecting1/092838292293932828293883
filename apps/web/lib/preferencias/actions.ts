"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"

import type { ActionResult } from "@/lib/auth/action-result"
import { requireUser } from "@/lib/auth/session"
import { createClient } from "@/lib/supabase/server"

const SAVE_ERROR = "Não foi possível salvar agora. Tente de novo."

/** Liga ou desliga "Letra e botões maiores" (upsert; RLS: só a própria linha). */
export async function setLargeText(enabled: boolean): Promise<ActionResult> {
  const parsed = z.boolean().safeParse(enabled)

  if (!parsed.success) {
    return { ok: false, error: "Preferência inválida." }
  }

  const user = await requireUser()
  const supabase = await createClient()
  const { error } = await supabase
    .from("email_preferences")
    .upsert({ user_id: user.id, large_text: parsed.data }, { onConflict: "user_id" })

  if (error) {
    console.error(
      `[preferencias] falha ao salvar a letra maior (código ${error.code || "desconhecido"})`
    )
    return { ok: false, error: SAVE_ERROR }
  }

  // O tamanho vale no CRM inteiro: o layout logado precisa renderizar de novo.
  revalidatePath("/", "layout")

  return {
    ok: true,
    message: parsed.data ? "Letra e botões maiores ligados." : "Letra e botões no tamanho normal.",
  }
}

/** Esconde ("Esconder") ou mostra de novo o cartão "Comece por aqui" do painel. */
export async function setGettingStartedDismissed(dismissed: boolean): Promise<ActionResult> {
  const parsed = z.boolean().safeParse(dismissed)

  if (!parsed.success) {
    return { ok: false, error: "Preferência inválida." }
  }

  const user = await requireUser()
  const supabase = await createClient()
  const { error } = await supabase.from("email_preferences").upsert(
    {
      user_id: user.id,
      getting_started_dismissed_at: parsed.data ? new Date().toISOString() : null,
    },
    { onConflict: "user_id" }
  )

  if (error) {
    console.error(
      `[preferencias] falha ao salvar o "Comece por aqui" (código ${error.code || "desconhecido"})`
    )
    return { ok: false, error: SAVE_ERROR }
  }

  revalidatePath("/painel")
  revalidatePath("/perfil")

  return {
    ok: true,
    message: parsed.data
      ? "Cartão escondido. Dá para mostrar de novo em Meu perfil."
      : "O cartão Comece por aqui voltou ao painel.",
  }
}

"use server"

import type { ActionResult } from "@/lib/auth/action-result"
import { createClient } from "@/lib/supabase/server"

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Dispensa um comunicado da plataforma para o usuário logado (em qualquer
 * aparelho). A RLS garante que a linha é dele e que o comunicado está no ar e é
 * do público dele; dispensar de novo conta como feito.
 */
export async function dismissPlatformAnnouncement(announcementId: string): Promise<ActionResult> {
  if (typeof announcementId !== "string" || !UUID_PATTERN.test(announcementId)) {
    return { ok: false, error: "Comunicado inválido." }
  }

  try {
    const supabase = await createClient()
    const { error } = await supabase
      .from("platform_announcement_dismissals")
      .insert({ announcement_id: announcementId.toLowerCase() })

    // 23505: já dispensado. 42501: a RLS não deixa porque o comunicado saiu do ar
    // (ou mudou de público) — ele também não volta a aparecer, então some da faixa.
    if (!error || error.code === "23505" || error.code === "42501") {
      return { ok: true }
    }

    console.error(`[crm] dispensa de comunicado recusada (código ${error.code || "desconhecido"})`)

    return {
      ok: false,
      error: "Não foi possível dispensar o comunicado agora. Tente de novo em instantes.",
    }
  } catch (cause) {
    console.error(
      `[crm] dispensa de comunicado falhou (${cause instanceof Error ? cause.name : "erro"})`
    )
    return {
      ok: false,
      error: "Não foi possível dispensar o comunicado agora. Tente de novo em instantes.",
    }
  }
}

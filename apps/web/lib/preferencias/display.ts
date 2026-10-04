import "server-only"

import { cache } from "react"

import { createClient } from "@/lib/supabase/server"

/**
 * Preferências de tela da pessoa (public.email_preferences, que só a própria
 * pessoa lê): letra e botões maiores e o cartão "Comece por aqui" escondido.
 * Sem linha no banco ou com erro de leitura: letra normal e cartão visível
 * (nunca quebra a página). Uma leitura por requisição (layout + painel).
 */

export type DisplayPreferences = {
  largeText: boolean
  gettingStartedDismissed: boolean
}

export const DEFAULT_DISPLAY_PREFERENCES: DisplayPreferences = {
  largeText: false,
  gettingStartedDismissed: false,
}

export const getDisplayPreferences = cache(async (userId: string): Promise<DisplayPreferences> => {
  try {
    const supabase = await createClient()
    const { data, error } = await supabase
      .from("email_preferences")
      .select("large_text, getting_started_dismissed_at")
      .eq("user_id", userId)
      .maybeSingle()

    if (error) {
      console.error(
        `[preferencias] falha ao carregar as preferências de tela (código ${error.code || "desconhecido"})`
      )
      return DEFAULT_DISPLAY_PREFERENCES
    }

    return {
      largeText: data?.large_text ?? false,
      gettingStartedDismissed: Boolean(data?.getting_started_dismissed_at),
    }
  } catch {
    return DEFAULT_DISPLAY_PREFERENCES
  }
})

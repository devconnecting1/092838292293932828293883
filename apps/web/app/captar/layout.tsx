import type { Metadata } from "next"

import { SupabaseSetupNotice } from "@/components/crm/supabase-setup-notice"
import { isSupabaseConfigured } from "@/lib/supabase/env"

/**
 * Página pública, sem login: não oferece o manifesto do CRM (app/manifest.ts),
 * para "Adicionar à tela de início" não instalar o CRM a partir dela.
 */
export const metadata: Metadata = {
  manifest: null,
}

/** Páginas públicas de captação: sem a casca do CRM e sem exigir login. */
export default function CaptarLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  if (!isSupabaseConfigured()) {
    return <SupabaseSetupNotice />
  }

  return children
}

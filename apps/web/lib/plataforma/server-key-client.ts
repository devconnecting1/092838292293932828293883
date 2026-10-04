import "server-only"

import { createClient, type SupabaseClient } from "@supabase/supabase-js"

import type { Database } from "@workspace/database/types"

import { getSupabaseEnv } from "@/lib/supabase/env"

/**
 * Cliente sem sessão (chave publishable) + PLATFORM_SERVER_KEY para as poucas
 * RPCs da equipe que rodam ANTES de a pessoa ser conferida como da equipe:
 * descobrir o papel (`platform_staff_role`), a prévia e o aceite do convite.
 *
 * Todo o resto do console passa por `withPlatformRpc` (lib/plataforma/rpc.ts),
 * que confere a equipe antes de ler a chave. Nunca service_role; nunca exponha
 * este cliente ao navegador.
 */
export type PlatformServerKeyClient = {
  supabase: SupabaseClient<Database>
  serverKey: string
}

/** null quando falta PLATFORM_SERVER_KEY ou a configuração do Supabase. */
export function createPlatformServerKeyClient(): PlatformServerKeyClient | null {
  const serverKey = process.env.PLATFORM_SERVER_KEY?.trim()
  const env = getSupabaseEnv()

  if (!serverKey || !env) {
    return null
  }

  return {
    serverKey,
    supabase: createClient<Database>(env.url, env.publishableKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    }),
  }
}

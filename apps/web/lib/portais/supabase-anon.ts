import "server-only"

import { createClient } from "@supabase/supabase-js"

import type { Database } from "@workspace/database/types"

import type { SupabaseEnv } from "@/lib/supabase/env"

/**
 * Cliente com a chave publishable/anon e SEM cookies de sessão, para rotas
 * públicas lidas por robôs (feed dos portais). Nunca usa service_role: o
 * acesso é decidido pela RPC security definer (slug + token).
 */
export function createAnonClient(env: SupabaseEnv) {
  return createClient<Database>(env.url, env.publishableKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  })
}

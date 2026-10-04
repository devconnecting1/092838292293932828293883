import "server-only"

import { createClient } from "@supabase/supabase-js"

import type { Database } from "@workspace/database/types"

import { getSupabaseEnv, SupabaseNotConfiguredError } from "@/lib/supabase/env"

/**
 * Cliente Supabase anônimo (sem cookies nem sessão) das landing pages. Só chama
 * as RPCs liberadas para `anon`: get_public_landing_page e submit_landing_lead.
 */
export function createLandingAnonClient() {
  const env = getSupabaseEnv()

  if (!env) {
    throw new SupabaseNotConfiguredError()
  }

  return createClient<Database>(env.url, env.publishableKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  })
}

import "server-only"

import { createServerClient } from "@supabase/ssr"
import { cookies, headers } from "next/headers"

import type { Database } from "@workspace/database/types"

import { getSessionCookieOptions } from "@/lib/supabase/cookie-options"
import { getSupabaseEnv, SupabaseNotConfiguredError } from "@/lib/supabase/env"

/**
 * Cliente Supabase para Server Components, Server Actions e Route Handlers.
 * Crie um cliente por requisição (nunca guarde em variável global).
 */
export async function createClient() {
  const env = getSupabaseEnv()

  if (!env) {
    throw new SupabaseNotConfiguredError()
  }

  const [cookieStore, headerList] = await Promise.all([cookies(), headers()])

  return createServerClient<Database>(env.url, env.publishableKey, {
    // Domain=.raiz em produção (sessão entre subdomínios); host-only em localhost.
    cookieOptions: getSessionCookieOptions(headerList.get("host")),
    cookies: {
      getAll() {
        return cookieStore.getAll()
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options)
          }
        } catch {
          // Server Components não podem gravar cookies. O proxy.ts renova a
          // sessão a cada requisição, então é seguro ignorar aqui.
        }
      },
    },
  })
}

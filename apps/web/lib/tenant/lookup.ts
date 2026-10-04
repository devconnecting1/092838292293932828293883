// Existência da imobiliária de um subdomínio, consultada pelo proxy.
// Sem `server-only`: o proxy não roda com a condição react-server.

import { createClient } from "@supabase/supabase-js"

import type { Database } from "@workspace/database/types"

import { getSupabaseEnv } from "@/lib/supabase/env"

const FOUND_TTL_MS = 5 * 60 * 1000
const MISSING_TTL_MS = 60 * 1000
const MAX_ENTRIES = 1000
const LOOKUP_TIMEOUT_MS = 3000

type CacheEntry = { exists: boolean; expiresAt: number }

// Cache por instância: evita uma RPC a cada requisição do mesmo subdomínio.
const cache = new Map<string, CacheEntry>()

function remember(slug: string, exists: boolean) {
  if (cache.size >= MAX_ENTRIES) {
    const oldest = cache.keys().next().value

    if (oldest !== undefined) {
      cache.delete(oldest)
    }
  }

  cache.set(slug, {
    exists,
    expiresAt: Date.now() + (exists ? FOUND_TTL_MS : MISSING_TTL_MS),
  })
}

/**
 * Se existe imobiliária com este slug (já validado como subdomínio). Usa a RPC
 * pública get_public_organization, a mesma do formulário /captar, que não
 * expõe nada além do que a página pública já mostra.
 *
 * Em falha do banco devolve `true` (não derruba o site): a página seguinte
 * repete as checagens e a autorização continua no servidor e no RLS.
 */
export async function tenantExists(slug: string): Promise<boolean> {
  const env = getSupabaseEnv()

  if (!env) {
    return true
  }

  const cached = cache.get(slug)

  if (cached && cached.expiresAt > Date.now()) {
    return cached.exists
  }

  try {
    const supabase = createClient<Database>(env.url, env.publishableKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    })
    const { data, error } = await supabase
      .rpc("get_public_organization", { p_slug: slug })
      .abortSignal(AbortSignal.timeout(LOOKUP_TIMEOUT_MS))

    if (error) {
      // Só o código: nada de slug no log.
      console.error(`[tenant] get_public_organization falhou: ${error.code ?? "erro"}`)
      return true
    }

    const exists = data !== null && typeof data === "object"
    remember(slug, exists)
    return exists
  } catch (cause) {
    console.error(
      `[tenant] consulta da imobiliária falhou (${cause instanceof Error ? cause.name : "erro"})`
    )
    return true
  }
}

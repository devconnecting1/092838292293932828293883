import "server-only"

import { createClient } from "@supabase/supabase-js"
import { unstable_cache } from "next/cache"

import type { PublicStatusSnapshot } from "@workspace/core/status/public"
import { parsePublicStatusSnapshot } from "@workspace/core/status/snapshot"
import type { Database } from "@workspace/database/types"

import { getSupabaseEnv } from "@/lib/supabase/env"

/**
 * Retrato público do status (/status, /api/status e faixa de incidente no CRM).
 * Só dado público (ver packages/core/src/status/public.ts). Em falha devolve
 * null — a tela mostra "não foi possível verificar agora", sem quebrar.
 *
 * Lê a RPC pública `get_public_status()` com a chave publishable e SEM sessão
 * (nenhum cookie, nenhum dado do usuário), e guarda o resultado no cache do
 * Next por 30 s, compartilhado entre requisições: muitos clientes abrindo a
 * página viram uma consulta ao banco a cada 30 s. O projeto não liga Cache
 * Components, então o cache é `unstable_cache` (mesmo padrão de
 * lib/billing/queries.ts). Erro não entra no cache: a função lança e quem chama
 * recebe null.
 */

/** Tag do cache: o console invalida depois de criar ou atualizar incidente. */
export const PUBLIC_STATUS_CACHE_TAG = "public-status"

/** Segundos que o retrato fica em cache no servidor (e no CDN, em /api/status). */
export const PUBLIC_STATUS_REVALIDATE_SECONDS = 30

class PublicStatusUnavailableError extends Error {
  constructor(reason: string) {
    super(`status público indisponível (${reason})`)
    this.name = "PublicStatusUnavailableError"
  }
}

async function fetchPublicStatus(): Promise<PublicStatusSnapshot> {
  const env = getSupabaseEnv()

  if (!env) {
    throw new PublicStatusUnavailableError("supabase_nao_configurado")
  }

  const supabase = createClient<Database>(env.url, env.publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })

  const { data, error } = await supabase.rpc("get_public_status")

  if (error) {
    throw new PublicStatusUnavailableError(error.code || "erro_rpc")
  }

  const snapshot = parsePublicStatusSnapshot(data)

  if (!snapshot) {
    throw new PublicStatusUnavailableError("formato_inesperado")
  }

  return snapshot
}

const fetchCachedPublicStatus = unstable_cache(fetchPublicStatus, ["public-status-snapshot"], {
  revalidate: PUBLIC_STATUS_REVALIDATE_SECONDS,
  tags: [PUBLIC_STATUS_CACHE_TAG],
})

function logFailure(cause: unknown) {
  // Só o motivo curto: nenhum dado de requisição ou do banco no log.
  console.error(
    `[status] ${cause instanceof PublicStatusUnavailableError ? cause.message : cause instanceof Error ? cause.name : "erro"}`
  )
}

export async function getPublicStatus(): Promise<PublicStatusSnapshot | null> {
  try {
    return await fetchCachedPublicStatus()
  } catch (cause) {
    logFailure(cause)
    return null
  }
}

/**
 * Mesmo retrato, sem cache: para o Console mostrar exatamente o que o público
 * vai ver logo depois de uma mudança. Não use em página pública.
 */
export async function getPublicStatusUncached(): Promise<PublicStatusSnapshot | null> {
  try {
    return await fetchPublicStatus()
  } catch (cause) {
    logFailure(cause)
    return null
  }
}

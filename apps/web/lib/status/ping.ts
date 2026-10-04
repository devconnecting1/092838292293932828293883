import "server-only"

import { createClient } from "@supabase/supabase-js"

import type { Database } from "@workspace/database/types"

import { getSupabaseEnv } from "@/lib/supabase/env"

/**
 * Checagem levíssima para a sonda da página de status (/api/status/ping), que
 * o banco chama a cada minuto (pg_cron + pg_net, segredo status_probe_url).
 *
 * - banco: RPC `status_ping()` (um `select true`, sem ler tabela);
 * - login: health do Auth do Supabase (`GET /auth/v1/health` com a chave
 *   publishable no cabeçalho `apikey`, como na documentação oficial:
 *   https://supabase.com/docs/guides/troubleshooting/how-do-i-check-gotrueapi-version-of-a-supabase-project-lQAnOR).
 *   A chave publishable é pública (vai no navegador); nunca service_role.
 *
 * Resultado guardado em memória por 10 s na instância: chamadas repetidas
 * (robô, curioso) não viram consulta ao banco nem ao Auth a cada acesso.
 * Nenhum dado sensível: só três booleanos.
 */

export type StatusPingResult = {
  /** App de pé e banco respondeu. */
  ok: boolean
  database: boolean
  /** Auth do Supabase respondeu 200; null se não deu para verificar (sem configuração). */
  auth: boolean | null
}

const MEMO_MS = 10_000
const DATABASE_TIMEOUT_MS = 2_500
const AUTH_TIMEOUT_MS = 2_000

let memo: { at: number; result: StatusPingResult } | null = null
let inflight: Promise<StatusPingResult> | null = null

async function checkDatabase(url: string, key: string): Promise<boolean> {
  const supabase = createClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })

  try {
    const { data, error } = await supabase
      .rpc("status_ping")
      .abortSignal(AbortSignal.timeout(DATABASE_TIMEOUT_MS))

    return !error && data === true
  } catch {
    return false
  }
}

async function checkAuth(url: string, key: string): Promise<boolean> {
  try {
    const response = await fetch(`${url.replace(/\/+$/, "")}/auth/v1/health`, {
      headers: { apikey: key },
      cache: "no-store",
      signal: AbortSignal.timeout(AUTH_TIMEOUT_MS),
    })

    // Descarta o corpo (versão do Auth): não precisamos dele.
    await response.body?.cancel()
    return response.ok
  } catch {
    return false
  }
}

async function runChecks(): Promise<StatusPingResult> {
  const env = getSupabaseEnv()

  if (!env) {
    return { ok: false, database: false, auth: null }
  }

  const [database, auth] = await Promise.all([
    checkDatabase(env.url, env.publishableKey),
    checkAuth(env.url, env.publishableKey),
  ])

  return { ok: database, database, auth }
}

export async function checkStatusPing(now: number = Date.now()): Promise<StatusPingResult> {
  if (memo && now - memo.at < MEMO_MS) {
    return memo.result
  }

  if (!inflight) {
    inflight = runChecks()
      .then((result) => {
        memo = { at: Date.now(), result }
        return result
      })
      .finally(() => {
        inflight = null
      })
  }

  return inflight
}

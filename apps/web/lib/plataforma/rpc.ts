import "server-only"

import { createClient, type SupabaseClient } from "@supabase/supabase-js"

import {
  parsePlatformHealthSnapshot,
  type PlatformHealthSnapshot,
} from "@workspace/core/platform/snapshot"
import { PLATFORM_VAULT_SECRET_NAMES } from "@workspace/core/platform/vault"
import type { Database } from "@workspace/database/types"

import { getPlatformAdmin, type PlatformAdmin } from "@/lib/plataforma/admin"
import { getSupabaseEnv } from "@/lib/supabase/env"

/**
 * Único ponto de chamada das RPCs globais do Console da Plataforma.
 *
 * Dados de TODAS as imobiliárias não passam por RLS de sessão: as RPCs
 * `platform_*` são `security definer` e exigem `p_server_key`. O servidor usa a
 * chave publishable + PLATFORM_SERVER_KEY (segredo `platform_server_key` do
 * Vault), nunca service_role.
 *
 * Defesa em profundidade: `withPlatformRpc` confere de novo o administrador
 * (e-mail confirmado em PLATFORM_ADMIN_EMAILS) ANTES de ler a chave, mesmo que
 * a página, o layout ou a Server Action já tenham conferido. Sem administrador,
 * nada é chamado.
 *
 * Contrato para os próximos módulos (Imobiliárias, Assinaturas, Custos de IA,
 * Comunicados, Registro):
 *
 *   const result = await withPlatformRpc("platform_list_organizations", async ({ supabase, serverKey }) => {
 *     const { data, error } = await supabase.rpc("platform_list_organizations", { p_server_key: serverKey })
 *     if (error) throwPlatformRpcError("platform_list_organizations", error)
 *     return parse(data)
 *   })
 *   if (!result.ok) → mostre <PlatformRpcFailureAlert failure={result} />
 *
 * - nunca lança: devolve `{ ok: false, reason, message }` com texto pronto;
 * - logs só com a operação e o código do erro (nunca o texto do banco);
 * - ação que ALTERA algo precisa gravar no registro: de preferência dentro da
 *   própria RPC (private.record_platform_audit_event, na mesma transação) ou,
 *   quando a mudança é fora do banco, com `logPlatformAction()`
 *   (lib/plataforma/audit.ts).
 */

export type PlatformRpcFailureReason =
  | "sem_acesso"
  | "sem_chave"
  | "supabase_nao_configurado"
  | "chave_recusada"
  | "dados_invalidos"
  | "falha"

export type PlatformRpcFailure = {
  ok: false
  reason: PlatformRpcFailureReason
  /** Código do Postgres/PostgREST, quando houver. */
  code: string | null
  /** Frase pronta para a tela, em pt-BR. */
  message: string
}

export type PlatformRpcResult<T> = { ok: true; data: T } | PlatformRpcFailure

export type PlatformRpcContext = {
  supabase: SupabaseClient<Database>
  serverKey: string
  /** Quem está agindo (já conferido). Use no registro do console. */
  admin: PlatformAdmin
}

export const PLATFORM_RPC_FAILURE_MESSAGES: Record<PlatformRpcFailureReason, string> = {
  sem_acesso: "Sua sessão não tem acesso ao Console da Plataforma.",
  sem_chave:
    "Configure PLATFORM_SERVER_KEY no servidor: copie o valor do segredo platform_server_key do Vault do Supabase para as variáveis do projeto na Vercel e refaça o deploy.",
  supabase_nao_configurado:
    "O servidor está sem NEXT_PUBLIC_SUPABASE_URL ou sem a chave publicável do Supabase.",
  chave_recusada:
    "O banco recusou a PLATFORM_SERVER_KEY: o valor não confere com o segredo platform_server_key do Vault (ou a migração do console não foi aplicada).",
  dados_invalidos: "O banco respondeu num formato inesperado. Atualize a página em instantes.",
  falha: "Não foi possível consultar o banco agora. Atualize a página em instantes.",
}

/** Erro de RPC com só o código (o texto do banco pode conter dados). */
export class PlatformRpcError extends Error {
  readonly code: string | null
  readonly reason: PlatformRpcFailureReason

  constructor(operation: string, code: string | null, reason: PlatformRpcFailureReason = "falha") {
    super(`${operation} falhou (${code ?? "sem código"})`)
    this.name = "PlatformRpcError"
    this.code = code
    this.reason = reason
  }
}

/** Converte o erro do supabase-js em PlatformRpcError (42501 = chave recusada). */
export function throwPlatformRpcError(
  operation: string,
  error: { code?: string | null } | null | undefined
): never {
  const code = error?.code || null
  throw new PlatformRpcError(operation, code, code === "42501" ? "chave_recusada" : "falha")
}

function failure(reason: PlatformRpcFailureReason, code: string | null = null): PlatformRpcFailure {
  return { ok: false, reason, code, message: PLATFORM_RPC_FAILURE_MESSAGES[reason] }
}

/** A chave do console está definida no servidor? (não diz se confere com o Vault) */
export function isPlatformServerKeyConfigured(): boolean {
  return (process.env.PLATFORM_SERVER_KEY?.trim() ?? "").length > 0
}

/**
 * Roda chamadas às RPCs `platform_*` depois de conferir o administrador e a
 * configuração. Nunca lança; erros viram `PlatformRpcFailure`.
 */
export async function withPlatformRpc<T>(
  operation: string,
  run: (context: PlatformRpcContext) => Promise<T>
): Promise<PlatformRpcResult<T>> {
  const admin = await getPlatformAdmin()

  if (!admin) {
    return failure("sem_acesso")
  }

  const serverKey = process.env.PLATFORM_SERVER_KEY?.trim()

  if (!serverKey) {
    return failure("sem_chave")
  }

  const env = getSupabaseEnv()

  if (!env) {
    return failure("supabase_nao_configurado")
  }

  const supabase = createClient<Database>(env.url, env.publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })

  try {
    return { ok: true, data: await run({ supabase, serverKey, admin }) }
  } catch (cause) {
    if (cause instanceof PlatformRpcError) {
      console.error(`[plataforma] ${operation} falhou (código ${cause.code ?? "desconhecido"})`)
      return failure(cause.reason, cause.code)
    }

    console.error(
      `[plataforma] ${operation} falhou (${cause instanceof Error ? cause.name : "erro"})`
    )
    return failure("falha")
  }
}

/** Retrato global da saúde do sistema (`platform_health`). */
export async function getPlatformHealthSnapshot(): Promise<
  PlatformRpcResult<PlatformHealthSnapshot>
> {
  const operation = "platform_health"

  return withPlatformRpc(operation, async ({ supabase, serverKey }) => {
    const { data, error } = await supabase.rpc(operation, {
      p_server_key: serverKey,
      p_secret_names: [...PLATFORM_VAULT_SECRET_NAMES],
    })

    if (error) {
      throwPlatformRpcError(operation, error)
    }

    if (typeof data !== "object" || data === null || Array.isArray(data)) {
      throw new PlatformRpcError(operation, null, "dados_invalidos")
    }

    return parsePlatformHealthSnapshot(data)
  })
}

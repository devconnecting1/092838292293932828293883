import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"

import type { Database, Tables } from "@workspace/database/types"

type ServerSupabaseClient = SupabaseClient<Database>

export type CaixaLoadSummary = Pick<
  Tables<"caixa_catalog_status">,
  | "lista_gerada_em"
  | "sincronizado_em"
  | "total_ativo"
  | "ultima_carga_total"
  | "ultima_carga_recusada"
  | "ultima_carga_saiu"
  | "last_checked_at"
  | "last_result"
  | "last_failure_at"
  | "last_failure_reason"
>

export type CaixaSyncEvent = Pick<
  Tables<"caixa_sync_events">,
  | "id"
  | "ocorrido_em"
  | "resultado"
  | "origem"
  | "lista_gerada_em"
  | "total"
  | "sairam"
  | "recusados"
  | "motivo"
>

/** Últimos registros da carga mostrados na tela interna. */
export const CAIXA_EVENTS_LIMIT = 10

/**
 * Resumo da última carga (uma linha só). Leitura com a sessão: a tabela é
 * legível por qualquer usuário autenticado e não tem dado pessoal.
 */
export async function getCaixaLoadSummary(
  supabase: ServerSupabaseClient
): Promise<CaixaLoadSummary | null> {
  const { data, error } = await supabase
    .from("caixa_catalog_status")
    .select(
      "lista_gerada_em, sincronizado_em, total_ativo, ultima_carga_total, ultima_carga_recusada, ultima_carga_saiu, last_checked_at, last_result, last_failure_at, last_failure_reason"
    )
    .maybeSingle()

  if (error) {
    throw new Error(`Não foi possível ler a última carga da Caixa (${error.code ?? "erro"}).`)
  }

  return data
}

export async function listCaixaSyncEvents(
  supabase: ServerSupabaseClient
): Promise<CaixaSyncEvent[]> {
  const { data, error } = await supabase
    .from("caixa_sync_events")
    .select("id, ocorrido_em, resultado, origem, lista_gerada_em, total, sairam, recusados, motivo")
    .order("ocorrido_em", { ascending: false })
    .order("id", { ascending: false })
    .limit(CAIXA_EVENTS_LIMIT)

  if (error) {
    throw new Error(`Não foi possível ler o histórico da Caixa (${error.code ?? "erro"}).`)
  }

  return data ?? []
}

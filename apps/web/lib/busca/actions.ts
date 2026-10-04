"use server"

import { requireMembership } from "@/lib/auth/session"
import { buildGlobalSearchGroups } from "@/lib/busca/results"
import {
  GLOBAL_SEARCH_LIMIT_PER_GROUP,
  GLOBAL_SEARCH_MIN_LENGTH,
  normalizeGlobalSearchTerm,
  type GlobalSearchResponse,
} from "@/lib/busca/types"
import { createClient } from "@/lib/supabase/server"

/**
 * Busca única do cabeçalho: clientes, leads e imóveis da imobiliária atual por
 * nome (sem acento), telefone (só dígitos) e código do imóvel.
 *
 * A RPC `search_crm` é `security invoker`: o RLS decide o que cada pessoa acha
 * (o corretor, só os clientes e leads dele). É uma Server Action (POST) para o
 * termo, que pode ser um telefone, nunca ir para a URL nem para o log.
 */
export async function searchCrmAction(query: unknown): Promise<GlobalSearchResponse> {
  const term = normalizeGlobalSearchTerm(query)

  if (term.length < GLOBAL_SEARCH_MIN_LENGTH) {
    return { ok: true, groups: [] }
  }

  const { membership } = await requireMembership()
  const supabase = await createClient()
  const { data, error } = await supabase.rpc("search_crm", {
    p_organization_id: membership.organizationId,
    p_term: term,
    p_limit: GLOBAL_SEARCH_LIMIT_PER_GROUP,
  })

  if (error) {
    // Só o código: o termo pode ser nome ou telefone de alguém.
    console.error("[busca] falha na busca do cabeçalho:", error.code ?? "erro desconhecido")
    return { ok: false }
  }

  return { ok: true, groups: buildGlobalSearchGroups(data) }
}

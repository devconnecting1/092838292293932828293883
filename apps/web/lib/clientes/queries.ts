import "server-only"

import { cache } from "react"
import { z } from "zod"

import type { Tables } from "@workspace/database/types"

import { CLIENTS_PAGE_SIZE } from "@/lib/clientes/constants"
import { UNASSIGNED_FILTER, type ClientListFilters } from "@/lib/clientes/filters"
import { createClient } from "@/lib/supabase/server"

export type ClientListRow = Pick<
  Tables<"clients">,
  | "id"
  | "kind"
  | "name"
  | "trade_name"
  | "document"
  | "email"
  | "phone"
  | "whatsapp"
  | "assigned_to"
  | "source"
  | "tags"
  | "created_at"
>

export type ClientListResult = {
  rows: ClientListRow[]
  total: number
  failed: boolean
}

/**
 * Lista de clientes pela RPC `search_clients` (security invoker: o RLS de
 * clients decide o que aparece). A busca ignora acento e maiúsculas no nome,
 * nome fantasia e e-mail ("Joao" acha "João"), acha telefone e WhatsApp pelos
 * dígitos em qualquer formato e o documento (CPF/CNPJ).
 */
export async function listClients(
  organizationId: string,
  filters: ClientListFilters
): Promise<ClientListResult> {
  const supabase = await createClient()
  // `undefined` sai do corpo do POST e o Postgres usa o default da função.
  const args = {
    p_organization_id: organizationId,
    p_term: filters.busca || undefined,
    p_kind: filters.tipo || undefined,
    p_unassigned: filters.responsavel === UNASSIGNED_FILTER || undefined,
    p_assigned_to:
      filters.responsavel && filters.responsavel !== UNASSIGNED_FILTER
        ? filters.responsavel
        : undefined,
    p_source: filters.origem || undefined,
    p_tag: filters.etiqueta || undefined,
  }

  const { data, error } = await supabase.rpc("search_clients", {
    ...args,
    p_limit: CLIENTS_PAGE_SIZE,
    p_offset: (filters.pagina - 1) * CLIENTS_PAGE_SIZE,
  })

  if (error) {
    return { rows: [], total: 0, failed: true }
  }

  // A RPC declara as colunas como não nulas, mas as opcionais do cadastro
  // chegam null: o tipo da lista volta a ser o da tabela.
  const rows: ClientListRow[] = data.map((row) => ({
    id: row.id,
    kind: row.kind,
    name: row.name,
    trade_name: row.trade_name,
    document: row.document,
    email: row.email,
    phone: row.phone,
    whatsapp: row.whatsapp,
    assigned_to: row.assigned_to,
    source: row.source,
    tags: row.tags,
    created_at: row.created_at,
  }))

  let total = data[0]?.total_count ?? 0

  // O total vem repetido em cada linha, então a página além da última não o
  // traz. Só nesse caso raro uma segunda chamada (uma linha) distingue "a busca
  // não achou nada" de "esta página não existe".
  if (rows.length === 0 && filters.pagina > 1) {
    const { data: firstPage } = await supabase.rpc("search_clients", {
      ...args,
      p_limit: 1,
      p_offset: 0,
    })

    total = firstPage?.[0]?.total_count ?? 0
  }

  return { rows, total, failed: false }
}

/** Etiquetas já usadas nos clientes visíveis (para o filtro e sugestões). */
export async function listClientTags(organizationId: string) {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from("clients")
    .select("tags")
    .eq("organization_id", organizationId)
    .limit(1000)

  if (error) {
    return []
  }

  return [...new Set(data.flatMap((row) => row.tags))].sort((a, b) => a.localeCompare(b, "pt-BR"))
}

/** Cliente da imobiliária atual; null se o id é inválido, não existe ou o RLS esconde. */
export const getClient = cache(async (organizationId: string, clientId: string) => {
  if (!z.guid().safeParse(clientId).success) {
    return null
  }

  const supabase = await createClient()
  const { data, error } = await supabase
    .from("clients")
    .select("*")
    .eq("id", clientId)
    .eq("organization_id", organizationId)
    .maybeSingle()

  if (error) {
    throw new Error(`Não foi possível carregar o cliente (${error.code ?? "erro"}).`)
  }

  return data
})

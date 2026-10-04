"use server"

import { CLIENT_KIND_LABELS } from "@workspace/core/properties/enums"

import { requireMembership } from "@/lib/auth/session"
import type { ClientOption } from "@/lib/clientes/options"
import { sanitizeSearchTerm } from "@/lib/clientes/search"
import { createClient } from "@/lib/supabase/server"

const SEARCH_LIMIT = 20

/**
 * Opções para os combobox de cliente, pela mesma RPC da lista de clientes
 * (`search_clients`, security invoker): o RLS limita aos clientes que o papel
 * enxerga, e a busca ignora acento e maiúsculas no nome, nome fantasia e e-mail
 * ("Joao" acha "João"), acha telefone e WhatsApp pelos dígitos e o documento.
 * Sem termo, vêm os cadastrados mais recentemente.
 */
export async function searchClientOptions(query: string): Promise<ClientOption[]> {
  const { membership } = await requireMembership()
  const term = sanitizeSearchTerm(query)
  const supabase = await createClient()

  const { data, error } = await supabase.rpc("search_clients", {
    p_organization_id: membership.organizationId,
    // `undefined` sai do corpo do POST e o Postgres usa o default da função.
    p_term: term || undefined,
    p_limit: SEARCH_LIMIT,
  })

  if (error) {
    return []
  }

  return data.map((client) => ({
    id: client.id,
    label: client.name,
    // A RPC declara as colunas como não nulas, mas o nome fantasia opcional chega null.
    description: [CLIENT_KIND_LABELS[client.kind], client.trade_name].filter(Boolean).join(" · "),
  }))
}

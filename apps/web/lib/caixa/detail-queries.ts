import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"

import type { Database } from "@workspace/database/types"

import type { CaixaListingItem } from "@/lib/caixa/list-queries"

type ServerSupabaseClient = SupabaseClient<Database>

/** Número do imóvel na Caixa: 1 a 13 dígitos, como na chave do catálogo. */
export function isCaixaListingNumber(value: string): boolean {
  return /^[0-9]{1,13}$/.test(value)
}

export type CaixaListingLink = {
  id: string
  clientId: string | null
  leadId: string | null
  /** Nome do cliente ou do lead; `null` quando o registro saiu do alcance. */
  name: string | null
  notes: string | null
  createdAt: string
}

export type CaixaListingDetail = {
  listing: CaixaListingItem
  links: CaixaListingLink[]
}

export async function getCaixaListing(
  supabase: ServerSupabaseClient,
  organizationId: string,
  numero: string
): Promise<CaixaListingDetail | null> {
  if (!isCaixaListingNumber(numero)) {
    return null
  }

  const [{ data: row, error }, { data: favorite }, { data: linkRows }] = await Promise.all([
    supabase.from("caixa_listings").select("*").eq("numero", numero).maybeSingle(),
    supabase
      .from("caixa_favorites")
      .select("numero")
      .eq("organization_id", organizationId)
      .eq("numero", numero)
      .maybeSingle(),
    supabase
      .from("caixa_client_links")
      .select("id, client_id, lead_id, notes, created_at")
      .eq("organization_id", organizationId)
      .eq("numero", numero)
      .order("created_at", { ascending: false })
      .limit(50),
  ])

  if (error || !row) {
    return null
  }

  const links = linkRows ?? []
  const clientIds = links.map((link) => link.client_id).filter((id): id is string => id !== null)
  const leadIds = links.map((link) => link.lead_id).filter((id): id is string => id !== null)

  // Duas consultas simples em vez de embed: a FK é composta
  // (organization_id, client_id) e o RLS já limita o que cada papel enxerga.
  const [{ data: clients }, { data: leads }] = await Promise.all([
    clientIds.length > 0
      ? supabase
          .from("clients")
          .select("id, name")
          .eq("organization_id", organizationId)
          .in("id", clientIds)
      : Promise.resolve({ data: [] as { id: string; name: string }[] }),
    leadIds.length > 0
      ? supabase
          .from("leads")
          .select("id, name")
          .eq("organization_id", organizationId)
          .in("id", leadIds)
      : Promise.resolve({ data: [] as { id: string; name: string }[] }),
  ])

  const nameById = new Map<string, string>()
  for (const client of clients ?? []) nameById.set(client.id, client.name)
  for (const lead of leads ?? []) nameById.set(lead.id, lead.name)

  return {
    listing: {
      numero: row.numero,
      uf: row.uf,
      cidade: row.cidade,
      bairro: row.bairro,
      endereco: row.endereco,
      preco: Number(row.preco),
      valorAvaliacao: row.valor_avaliacao === null ? null : Number(row.valor_avaliacao),
      desconto: row.desconto === null ? null : Number(row.desconto),
      aceitaFinanciamento: row.aceita_financiamento,
      descricao: row.descricao,
      modalidade: row.modalidade,
      link: row.link,
      tipo: row.tipo,
      areaTotal: row.area_total === null ? null : Number(row.area_total),
      areaPrivativa: row.area_privativa === null ? null : Number(row.area_privativa),
      areaTerreno: row.area_terreno === null ? null : Number(row.area_terreno),
      quartos: row.quartos,
      vagas: row.vagas,
      listaGeradaEm: row.lista_gerada_em,
      saiuDaListaEm: row.saiu_da_lista_em,
      isFavorite: favorite !== null && favorite !== undefined,
      linkCount: links.length,
    },
    links: links.map((link) => ({
      id: link.id,
      clientId: link.client_id,
      leadId: link.lead_id,
      name: nameById.get(link.client_id ?? link.lead_id ?? "") ?? null,
      notes: link.notes,
      createdAt: link.created_at,
    })),
  }
}

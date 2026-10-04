import "server-only"

import { cache } from "react"

import type { Tables } from "@workspace/database/types"

import { buildCondominiumSearchFilter } from "@/lib/condominios/search"
import { isUuid } from "@/lib/imoveis/ids"
import { createClient } from "@/lib/supabase/server"

type ServerSupabaseClient = Awaited<ReturnType<typeof createClient>>

export const CONDOMINIUMS_PAGE_SIZE = 20
export const LINKED_PROPERTIES_LIMIT = 100

export type CondominiumListItem = Pick<
  Tables<"condominiums">,
  "id" | "name" | "neighborhood" | "city" | "state" | "amenities" | "avg_condo_fee"
> & {
  propertiesCount: number
}

export type CondominiumListResult =
  | { status: "ok"; rows: CondominiumListItem[]; total: number }
  | { status: "out-of-range" }
  | { status: "error" }

/**
 * Página da lista de condomínios da imobiliária, com a contagem de imóveis
 * vinculados embutida (properties(count) pela FK composta
 * properties_condominium_fkey).
 */
export async function listCondominiums(
  supabase: ServerSupabaseClient,
  organizationId: string,
  { term, page }: { term: string; page: number }
): Promise<CondominiumListResult> {
  const from = (page - 1) * CONDOMINIUMS_PAGE_SIZE
  const to = from + CONDOMINIUMS_PAGE_SIZE - 1

  let request = supabase
    .from("condominiums")
    .select("id, name, neighborhood, city, state, amenities, avg_condo_fee, properties(count)", {
      count: "exact",
    })
    .eq("organization_id", organizationId)

  if (term) {
    request = request.or(buildCondominiumSearchFilter(term))
  }

  const { data, error, count } = await request.order("name").order("id").range(from, to)

  if (error) {
    // PGRST103: página além do total ("Requested range not satisfiable").
    return error.code === "PGRST103" ? { status: "out-of-range" } : { status: "error" }
  }

  return {
    status: "ok",
    total: count ?? 0,
    rows: (data ?? []).map((row) => ({
      id: row.id,
      name: row.name,
      neighborhood: row.neighborhood,
      city: row.city,
      state: row.state,
      amenities: row.amenities,
      avg_condo_fee: row.avg_condo_fee,
      propertiesCount: row.properties[0]?.count ?? 0,
    })),
  }
}

/** Condomínio da imobiliária atual; null se o id for inválido ou não existir nela. */
export const getCondominium = cache(
  async (organizationId: string, condominiumId: string): Promise<Tables<"condominiums"> | null> => {
    if (!isUuid(condominiumId)) return null

    const supabase = await createClient()
    const { data, error } = await supabase
      .from("condominiums")
      .select("*")
      .eq("organization_id", organizationId)
      .eq("id", condominiumId)
      .maybeSingle()

    if (error) {
      throw new Error(`Não foi possível carregar o condomínio (${error.code ?? "erro"}).`)
    }

    return data
  }
)

export type LinkedProperty = Pick<
  Tables<"properties">,
  "id" | "code" | "title" | "status" | "purpose" | "sale_price" | "rent_price" | "imob_score"
> & {
  coverPath: string | null
}

/** Imóveis vinculados ao condomínio (até LINKED_PROPERTIES_LIMIT) com a foto de capa. */
export async function getLinkedProperties(
  supabase: ServerSupabaseClient,
  organizationId: string,
  condominiumId: string
): Promise<{ rows: LinkedProperty[]; total: number }> {
  const { data, error, count } = await supabase
    .from("properties")
    .select("id, code, title, status, purpose, sale_price, rent_price, imob_score", {
      count: "exact",
    })
    .eq("organization_id", organizationId)
    .eq("condominium_id", condominiumId)
    .order("code")
    .limit(LINKED_PROPERTIES_LIMIT)

  if (error) {
    throw new Error(`Não foi possível carregar os imóveis do condomínio (${error.code ?? "erro"}).`)
  }

  const properties = data ?? []
  const covers = new Map<string, string>()

  if (properties.length > 0) {
    const { data: media, error: mediaError } = await supabase
      .from("property_media")
      .select("property_id, storage_path")
      .eq("organization_id", organizationId)
      .eq("is_cover", true)
      .in(
        "property_id",
        properties.map((property) => property.id)
      )

    // Sem capa não impede a ficha: o card mostra o ícone no lugar da foto.
    if (!mediaError) {
      for (const item of media ?? []) {
        if (item.storage_path) covers.set(item.property_id, item.storage_path)
      }
    }
  }

  return {
    total: count ?? properties.length,
    rows: properties.map((property) => ({
      ...property,
      coverPath: covers.get(property.id) ?? null,
    })),
  }
}

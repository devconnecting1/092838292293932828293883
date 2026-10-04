"use server"

import { PROPERTY_STATUS_LABELS } from "@workspace/core/properties/enums"

import { requireMembership } from "@/lib/auth/session"
import type { PropertyOption } from "@/lib/clientes/options"
import { buildPropertySearchFilter, sanitizeSearchTerm } from "@/lib/clientes/search"
import { createClient } from "@/lib/supabase/server"

/** Opções para o combobox de imóveis (busca por código, título ou bairro). */
export async function searchPropertyOptions(query: string): Promise<PropertyOption[]> {
  const { membership } = await requireMembership()
  const term = sanitizeSearchTerm(query)
  const supabase = await createClient()

  let request = supabase
    .from("properties")
    .select("id, code, title, neighborhood, city, status")
    .eq("organization_id", membership.organizationId)
    .order("code", { ascending: false })
    .limit(20)

  if (term) {
    request = request.or(buildPropertySearchFilter(term))
  }

  const { data, error } = await request

  if (error) {
    return []
  }

  return data.map((property) => ({
    id: property.id,
    label: `${property.code} · ${property.title}`,
    description: [
      property.neighborhood,
      property.city,
      property.status === "active" ? null : PROPERTY_STATUS_LABELS[property.status],
    ]
      .filter(Boolean)
      .join(" · "),
  }))
}

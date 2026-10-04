import "server-only"

import type { Tables } from "@workspace/database/types"

import { isRole, type Role } from "@/lib/auth/roles"
import { isUuid } from "@/lib/imoveis/ids"
import type { AuthorizationPeriod, MediaSource } from "@/lib/imoveis/mappers"
import type { createClient } from "@/lib/supabase/server"

export type ServerSupabaseClient = Awaited<ReturnType<typeof createClient>>

export type OrganizationMember = {
  id: string
  name: string
  role: Role
  active: boolean
}

/**
 * Membros da imobiliária com nome (memberships + profiles). Inclui inativos
 * para exibir o nome de quem já saiu; filtre `active` para listas de escolha.
 */
export async function getOrganizationMembers(
  supabase: ServerSupabaseClient,
  organizationId: string
): Promise<OrganizationMember[]> {
  const { data: memberships, error } = await supabase
    .from("memberships")
    .select("user_id, role, active")
    .eq("organization_id", organizationId)

  if (error) {
    throw new Error(`Não foi possível carregar a equipe (${error.code ?? "erro"}).`)
  }

  const ids = (memberships ?? []).map((item) => item.user_id)
  const profiles = new Map<string, { full_name: string | null; email: string | null }>()

  if (ids.length > 0) {
    const { data, error: profilesError } = await supabase
      .from("profiles")
      .select("id, full_name, email")
      .in("id", ids)

    if (profilesError) {
      throw new Error(`Não foi possível carregar a equipe (${profilesError.code ?? "erro"}).`)
    }

    for (const profile of data ?? []) {
      profiles.set(profile.id, profile)
    }
  }

  return (memberships ?? [])
    .filter((item) => isRole(item.role))
    .map((item) => {
      const profile = profiles.get(item.user_id)
      return {
        id: item.user_id,
        name: profile?.full_name?.trim() || profile?.email || "Membro sem nome",
        role: item.role as Role,
        active: item.active,
      }
    })
    .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"))
}

export function toMemberNameMap(members: readonly OrganizationMember[]) {
  return new Map(members.map((member) => [member.id, member.name]))
}

export type CondominiumOption = Pick<
  Tables<"condominiums">,
  "id" | "name" | "neighborhood" | "city"
>

export async function getCondominiumOptions(
  supabase: ServerSupabaseClient,
  organizationId: string
): Promise<CondominiumOption[]> {
  const { data, error } = await supabase
    .from("condominiums")
    .select("id, name, neighborhood, city")
    .eq("organization_id", organizationId)
    .order("name")
    .limit(1000)

  if (error) {
    throw new Error(`Não foi possível carregar os condomínios (${error.code ?? "erro"}).`)
  }

  return data ?? []
}

/** Imóvel da imobiliária atual; null se o id for inválido ou não existir nela. */
export async function getPropertyRow(
  supabase: ServerSupabaseClient,
  organizationId: string,
  propertyId: string
): Promise<Tables<"properties"> | null> {
  if (!isUuid(propertyId)) return null

  const { data, error } = await supabase
    .from("properties")
    .select("*")
    .eq("organization_id", organizationId)
    .eq("id", propertyId)
    .maybeSingle()

  if (error) {
    throw new Error(`Não foi possível carregar o imóvel (${error.code ?? "erro"}).`)
  }

  return data
}

export async function getPropertyMediaRows(
  supabase: ServerSupabaseClient,
  organizationId: string,
  propertyId: string
): Promise<MediaSource[]> {
  const { data, error } = await supabase
    .from("property_media")
    .select("id, kind, storage_path, external_url, is_cover, caption, position")
    .eq("organization_id", organizationId)
    .eq("property_id", propertyId)
    .order("position")
    .order("created_at")

  if (error) {
    throw new Error(`Não foi possível carregar as mídias do imóvel (${error.code ?? "erro"}).`)
  }

  return data ?? []
}

export async function getAuthorizationPeriods(
  supabase: ServerSupabaseClient,
  organizationId: string,
  propertyId: string
): Promise<AuthorizationPeriod[]> {
  const { data, error } = await supabase
    .from("listing_authorizations")
    .select("starts_on, ends_on")
    .eq("organization_id", organizationId)
    .eq("property_id", propertyId)

  if (error) {
    throw new Error(`Não foi possível carregar as autorizações (${error.code ?? "erro"}).`)
  }

  return data ?? []
}

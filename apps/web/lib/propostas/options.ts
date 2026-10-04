import "server-only"

import type { Enums } from "@workspace/database/types"

import { isRole, type Role } from "@/lib/auth/roles"
import type { createClient } from "@/lib/supabase/server"

type ServerClient = Awaited<ReturnType<typeof createClient>>

export type TeamMemberOption = {
  value: string
  label: string
  role: Role
}

export type PropertyOption = {
  value: string
  label: string
  code: string
  title: string
  status: Enums<"property_status">
  purpose: Enums<"listing_purpose">
  capturedBy: string | null
  brokerId: string | null
}

export type ClientOption = {
  value: string
  label: string
}

const OPTIONS_LIMIT = 1000

/** Membros ativos da imobiliária, com nome do perfil. */
export async function getTeamMembers(
  supabase: ServerClient,
  organizationId: string
): Promise<TeamMemberOption[]> {
  const { data: memberships, error } = await supabase
    .from("memberships")
    .select("user_id, role")
    .eq("organization_id", organizationId)
    .eq("active", true)

  if (error) {
    throw new Error(`Não foi possível carregar a equipe (${error.code ?? "erro"}).`)
  }

  const names = await getProfileNames(
    supabase,
    memberships.map((membership) => membership.user_id)
  )

  return memberships
    .filter((membership) => isRole(membership.role))
    .map((membership) => ({
      value: membership.user_id,
      label: names.get(membership.user_id) ?? "Membro sem nome",
      role: membership.role as Role,
    }))
    .sort((a, b) => a.label.localeCompare(b.label, "pt-BR"))
}

/** Nome de exibição dos perfis (nome completo ou e-mail) por id de usuário. */
export async function getProfileNames(supabase: ServerClient, userIds: string[]) {
  const ids = [...new Set(userIds.filter(Boolean))]
  const names = new Map<string, string>()

  if (ids.length === 0) {
    return names
  }

  const { data, error } = await supabase
    .from("profiles")
    .select("id, full_name, email")
    .in("id", ids)

  if (error) {
    throw new Error(`Não foi possível carregar os nomes da equipe (${error.code ?? "erro"}).`)
  }

  for (const profile of data) {
    const label = profile.full_name?.trim() || profile.email?.trim()

    if (label) {
      names.set(profile.id, label)
    }
  }

  return names
}

export async function getPropertyOptions(
  supabase: ServerClient,
  organizationId: string
): Promise<PropertyOption[]> {
  const { data, error } = await supabase
    .from("properties")
    .select("id, code, title, status, purpose, captured_by, broker_id")
    .eq("organization_id", organizationId)
    .order("code", { ascending: false })
    .limit(OPTIONS_LIMIT)

  if (error) {
    throw new Error(`Não foi possível carregar os imóveis (${error.code ?? "erro"}).`)
  }

  return data.map((property) => ({
    value: property.id,
    label: `${property.code} · ${property.title}`,
    code: property.code,
    title: property.title,
    status: property.status,
    purpose: property.purpose,
    capturedBy: property.captured_by,
    brokerId: property.broker_id,
  }))
}

/** Clientes que o usuário pode ver (o RLS já filtra). */
export async function getClientOptions(
  supabase: ServerClient,
  organizationId: string
): Promise<ClientOption[]> {
  const { data, error } = await supabase
    .from("clients")
    .select("id, name")
    .eq("organization_id", organizationId)
    .order("name")
    .limit(OPTIONS_LIMIT)

  if (error) {
    throw new Error(`Não foi possível carregar os clientes (${error.code ?? "erro"}).`)
  }

  return data.map((client) => ({ value: client.id, label: client.name }))
}

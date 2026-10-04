import "server-only"

import { cache } from "react"

import { isRole } from "@/lib/auth/roles"
import type { MemberOption } from "@/lib/clientes/options"
import { createClient } from "@/lib/supabase/server"

/**
 * Membros ativos da imobiliária com nome do perfil. Memoizado por requisição.
 * memberships.user_id aponta para auth.users (sem FK para profiles), por isso
 * são duas consultas.
 */
export const getOrganizationMembers = cache(
  async (organizationId: string): Promise<MemberOption[]> => {
    const supabase = await createClient()
    const { data: memberships, error } = await supabase
      .from("memberships")
      .select("user_id, role")
      .eq("organization_id", organizationId)
      .eq("active", true)

    if (error) {
      throw new Error(`Não foi possível carregar a equipe (${error.code ?? "erro"}).`)
    }

    const userIds = memberships.map((membership) => membership.user_id)

    if (userIds.length === 0) {
      return []
    }

    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, full_name, email")
      .in("id", userIds)

    const profileById = new Map((profiles ?? []).map((profile) => [profile.id, profile]))
    const members: MemberOption[] = []

    for (const membership of memberships) {
      if (!isRole(membership.role)) {
        continue
      }

      const profile = profileById.get(membership.user_id)

      members.push({
        id: membership.user_id,
        name: profile?.full_name?.trim() || profile?.email || "Membro sem nome",
        role: membership.role,
      })
    }

    return members.sort((a, b) => a.name.localeCompare(b.name, "pt-BR"))
  }
)

import "server-only"

import type { ImportMember } from "@workspace/core/import/validate"

import { createClient } from "@/lib/supabase/server"

/**
 * Equipe ativa com nome e e-mail, para reconhecer o "Corretor responsável" da
 * planilha. Só a página de importação (dono e gerente) chama.
 */
export async function getImportMembers(organizationId: string): Promise<ImportMember[]> {
  const supabase = await createClient()
  const { data: memberships, error } = await supabase
    .from("memberships")
    .select("user_id")
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

  return (profiles ?? [])
    .map((profile) => ({
      id: profile.id,
      name: profile.full_name?.trim() || profile.email || "Membro sem nome",
      email: profile.email,
    }))
    .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"))
}

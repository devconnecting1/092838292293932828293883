import type { Role } from "@/lib/auth/roles"

/** Membro ativo da imobiliária, para selects de responsável/corretor. */
export type MemberOption = {
  id: string
  name: string
  role: Role
}

/** Opção de combobox (cliente ou imóvel). */
export type EntityOption = {
  id: string
  label: string
  description: string | null
}

export type ClientOption = EntityOption
export type PropertyOption = EntityOption

export function getMemberName(
  members: readonly MemberOption[],
  userId: string | null | undefined,
  fallback = "—"
) {
  if (!userId) {
    return fallback
  }

  return members.find((member) => member.id === userId)?.name ?? "Ex-membro"
}

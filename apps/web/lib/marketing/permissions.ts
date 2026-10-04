import type { Role } from "@/lib/auth/roles"

/**
 * Quem cria, edita, publica e arquiva landing pages (espelha o RLS de
 * landing_pages e do bucket landing-assets). Os demais membros só visualizam.
 */
export const LANDING_EDITOR_ROLES: readonly Role[] = ["owner", "manager", "assistant"]

export function canEditLandingPages(role: Role) {
  return LANDING_EDITOR_ROLES.includes(role)
}

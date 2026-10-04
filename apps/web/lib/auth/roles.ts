export const ROLES = ["owner", "manager", "broker", "capturer", "assistant", "finance"] as const

export type Role = (typeof ROLES)[number]

export const ROLE_LABELS: Record<Role, string> = {
  owner: "Dono",
  manager: "Gerente",
  broker: "Corretor",
  capturer: "Captador",
  assistant: "Assistente",
  finance: "Financeiro",
}

/** Quem gerencia a equipe (convites, papéis). */
export const TEAM_MANAGER_ROLES: readonly Role[] = ["owner", "manager"]

/** Quem pode ver os dados da imobiliária (somente o dono edita). */
export const ORGANIZATION_VIEWER_ROLES: readonly Role[] = ["owner", "manager", "finance"]

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value)
}

export function hasRole(role: Role, allowed: readonly Role[]) {
  return allowed.includes(role)
}

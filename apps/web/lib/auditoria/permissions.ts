import type { Role } from "@/lib/auth/roles"

/**
 * Espelho da política `audit_events: dono e gerente leem`. Serve só para
 * esconder a aba na interface — quem garante é o RLS.
 */
const AUDIT_READER_ROLES: readonly Role[] = ["owner", "manager"]

export function canViewAuditTrail(role: Role) {
  return AUDIT_READER_ROLES.includes(role)
}

export { AUDIT_READER_ROLES }

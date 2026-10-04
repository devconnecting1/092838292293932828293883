import type { Role } from "@/lib/auth/roles"

/**
 * Espelho, para a interface, das políticas RLS de appointments. A garantia
 * continua sendo o banco.
 */
export const APPOINTMENT_MANAGER_ROLES: readonly Role[] = ["owner", "manager", "assistant"]
export const APPOINTMENT_VIEW_ALL_ROLES: readonly Role[] = [
  "owner",
  "manager",
  "assistant",
  "finance",
]

/** Financeiro só lê a agenda. */
export function canScheduleAppointments(role: Role) {
  return role !== "finance"
}

/** Gestão agenda para qualquer corretor; corretor e captador só para si. */
export function canScheduleForOthers(role: Role) {
  return APPOINTMENT_MANAGER_ROLES.includes(role)
}

/** Vê a agenda de toda a equipe (e escolhe o filtro por corretor). */
export function canViewAllAppointments(role: Role) {
  return APPOINTMENT_VIEW_ALL_ROLES.includes(role)
}

export function canUpdateAppointment(
  role: Role,
  appointment: { brokerId: string | null; createdBy: string | null },
  userId: string
) {
  if (APPOINTMENT_MANAGER_ROLES.includes(role)) {
    return true
  }

  if (role === "broker" || role === "capturer") {
    return appointment.brokerId === userId || appointment.createdBy === userId
  }

  return false
}

export function canDeleteAppointments(role: Role) {
  return role === "owner" || role === "manager"
}

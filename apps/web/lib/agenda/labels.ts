import { formatDateKey, toDateKey, toTimeKey } from "@/lib/agenda/datetime"
import type { Role } from "@/lib/auth/roles"
import type { MemberOption } from "@/lib/clientes/options"

/** "IMV-000123 · Título do imóvel" */
export function formatPropertyLabel(property: { code: string; title: string }) {
  return `${property.code} · ${property.title}`
}

/** "15/09/2026 às 14:30" no fuso de Brasília. */
export function formatVisitMoment(startsAt: string) {
  return `${formatDateKey(toDateKey(startsAt))} às ${toTimeKey(startsAt)}`
}

/** Papéis que podem ser corretor de uma visita (financeiro não visita). */
const VISIT_BROKER_ROLES: readonly Role[] = ["owner", "manager", "broker", "capturer", "assistant"]

export function getVisitBrokers(members: readonly MemberOption[]) {
  return members.filter((member) => VISIT_BROKER_ROLES.includes(member.role))
}

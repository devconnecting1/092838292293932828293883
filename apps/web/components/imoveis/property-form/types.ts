import type { PropertyStatus } from "@workspace/core/properties/enums"

import { ROLE_LABELS, type Role } from "@/lib/auth/roles"

export type MemberOption = {
  id: string
  name: string
  roleLabel: string
  active: boolean
}

export type CaptureSummary = {
  id: string
  ownerName: string
  ownerEmail: string | null
  ownerPhone: string | null
}

export type PropertySummary = {
  id: string
  code: string
  status: PropertyStatus
}

/** Membros ativos + os já vinculados ao imóvel (mesmo que inativos, para exibir o nome). */
export function toMemberOptions(
  members: readonly { id: string; name: string; role: Role; active: boolean }[],
  keepIds: readonly (string | null)[] = []
): MemberOption[] {
  return members
    .filter((member) => member.active || keepIds.includes(member.id))
    .map((member) => ({
      id: member.id,
      name: member.name,
      roleLabel: ROLE_LABELS[member.role],
      active: member.active,
    }))
}

import "server-only"

import type { Role } from "@/lib/auth/roles"
import { requireMembership, type MembershipContext } from "@/lib/auth/session"
import { PERMISSION_DENIED_MESSAGE } from "@/lib/configuracoes/errors"

export type FormActionResult<Field extends string = string> =
  | { ok: true; message?: string }
  | { ok: false; error: string; fieldErrors?: Partial<Record<Field, string>> }

type ActionMembership = { ok: true; context: MembershipContext } | { ok: false; error: string }

/**
 * Sessão e imobiliária atual para Server Actions. Sem login, redireciona
 * (requireMembership); sem o papel exigido, devolve erro em vez de redirecionar.
 * A imobiliária vem sempre do servidor (cookie validado), nunca do formulário.
 */
export async function getActionMembership(allowed?: readonly Role[]): Promise<ActionMembership> {
  const context = await requireMembership()

  if (allowed && !allowed.includes(context.membership.role)) {
    return { ok: false, error: PERMISSION_DENIED_MESSAGE }
  }

  return { ok: true, context }
}

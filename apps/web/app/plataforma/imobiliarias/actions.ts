"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"

import {
  checkActionReason,
  isTrialExtensionDays,
  PLATFORM_ORGANIZATIONS_PATH,
} from "@workspace/core/platform/accounts"
import { PLATFORM_READ_ONLY_MESSAGE } from "@workspace/core/platform/staff"

import type { ActionResult } from "@/lib/auth/action-result"
import { canAct, getPlatformAdmin } from "@/lib/plataforma/admin"
import { extendPlatformTrial, setPlatformOrganizationBlock } from "@/lib/plataforma/imobiliarias"

/**
 * Ações da ficha da imobiliária no Console da Plataforma. Cada uma confere de
 * novo a pessoa da equipe e o papel (a página não roda antes da Server Action;
 * "Somente leitura" não age), valida o formulário e chama a RPC, que grava o
 * registro do console na mesma transação (e também recusa Somente leitura).
 * Nada é apagado.
 */

const NOT_ALLOWED: ActionResult = { ok: false, error: "Sua sessão não tem acesso a esta ação." }
const READ_ONLY: ActionResult = { ok: false, error: PLATFORM_READ_ONLY_MESSAGE }
const INVALID_ORGANIZATION: ActionResult = { ok: false, error: "Imobiliária inválida." }

/** null = pode agir; senão o resultado de recusa. */
async function denyUnlessCanAct(): Promise<ActionResult | null> {
  const admin = await getPlatformAdmin()

  if (!admin) {
    return NOT_ALLOWED
  }

  return canAct(admin) ? null : READ_ONLY
}

const organizationIdSchema = z.guid()

function revalidateConsole(organizationId: string) {
  revalidatePath(PLATFORM_ORGANIZATIONS_PATH)
  revalidatePath(`${PLATFORM_ORGANIZATIONS_PATH}/${organizationId}`)
  revalidatePath("/plataforma/assinaturas")
}

export async function setOrganizationBlockAction(input: {
  organizationId: string
  blocked: boolean
  reason: string
}): Promise<ActionResult> {
  const denied = await denyUnlessCanAct()

  if (denied) {
    return denied
  }

  const organizationId = organizationIdSchema.safeParse(input?.organizationId)

  if (!organizationId.success || typeof input.blocked !== "boolean") {
    return INVALID_ORGANIZATION
  }

  const reason = checkActionReason(input.reason)

  if (!reason.ok) {
    return { ok: false, error: reason.message }
  }

  const result = await setPlatformOrganizationBlock({
    organizationId: organizationId.data,
    blocked: input.blocked,
    reason: reason.reason,
  })

  if (!result.ok) {
    return result
  }

  revalidateConsole(organizationId.data)
  return { ok: true, message: result.message }
}

export async function extendTrialAction(input: {
  organizationId: string
  days: number
  reason: string
}): Promise<ActionResult> {
  const denied = await denyUnlessCanAct()

  if (denied) {
    return denied
  }

  const organizationId = organizationIdSchema.safeParse(input?.organizationId)

  if (!organizationId.success) {
    return INVALID_ORGANIZATION
  }

  if (!isTrialExtensionDays(input.days)) {
    return { ok: false, error: "Escolha prorrogar por 7 ou 14 dias." }
  }

  const reason = checkActionReason(input.reason)

  if (!reason.ok) {
    return { ok: false, error: reason.message }
  }

  const result = await extendPlatformTrial({
    organizationId: organizationId.data,
    days: input.days,
    reason: reason.reason,
  })

  if (!result.ok) {
    return result
  }

  revalidateConsole(organizationId.data)
  return { ok: true, message: result.message }
}

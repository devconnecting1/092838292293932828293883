"use server"

import { revalidatePath } from "next/cache"

import { formatBRL } from "@workspace/core/billing"

import { setAiOverageCapRpc } from "@/lib/ai/rpc"
import { aiOverageCapSchema, parseOverageCapCents, type AiOverageCapValues } from "@/lib/ai/schemas"
import { SUBSCRIPTION_SETTINGS_PATH } from "@/lib/auth/routes"
import { getActionMembership, type FormActionResult } from "@/lib/configuracoes/action-context"

const MANAGERS = ["owner", "manager"] as const

const GENERIC_ERROR = "Não foi possível salvar o teto de excedente agora. Tente de novo."

/**
 * Define o teto de excedente de IA da imobiliária (0 = não permitir excedente).
 * Só dono e gerente; quem grava é a RPC set_ai_overage_cap (billing_accounts
 * não aceita escrita com sessão).
 */
export async function updateAiOverageCap(
  values: AiOverageCapValues
): Promise<FormActionResult<keyof AiOverageCapValues>> {
  const parsed = aiOverageCapSchema.safeParse(values)
  const cents = parsed.success ? parseOverageCapCents(parsed.data.overageCap) : null

  if (!parsed.success || cents === null) {
    return {
      ok: false,
      error: "Confira o valor informado.",
      fieldErrors: { overageCap: "Informe um valor em reais, como 50,00." },
    }
  }

  const auth = await getActionMembership(MANAGERS)

  if (!auth.ok) {
    return auth
  }

  try {
    await setAiOverageCapRpc(auth.context.membership.organizationId, cents)
  } catch (error) {
    console.error(`[ia] teto de excedente: ${error instanceof Error ? error.name : "erro"}`)
    return { ok: false, error: GENERIC_ERROR }
  }

  revalidatePath(SUBSCRIPTION_SETTINGS_PATH)

  return {
    ok: true,
    message:
      cents > 0
        ? `Excedente de IA liberado até ${formatBRL(cents)} por ciclo.`
        : "Excedente de IA desligado: a IA para quando a franquia acabar.",
  }
}

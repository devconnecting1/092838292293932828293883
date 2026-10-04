"use server"

import { revalidatePath } from "next/cache"

import type { ActionResult } from "@/lib/auth/action-result"
import { INVALID_FIELDS_MESSAGE } from "@/lib/clientes/action-result"
import { getActionMembership, type FormActionResult } from "@/lib/configuracoes/action-context"
import { translateDatabaseError } from "@/lib/configuracoes/errors"
import { getFieldErrors } from "@/lib/configuracoes/schemas"
import { FORECAST_EDITOR_ROLES, FORECAST_SETTINGS_PATH } from "@/lib/previsao/constants"
import { stageProbabilitiesSchema, type StageProbabilitiesValues } from "@/lib/previsao/schemas"
import { createClient } from "@/lib/supabase/server"

const OWNER_ONLY_MESSAGE = "Só o dono da imobiliária muda a probabilidade de fechamento por etapa."

function revalidateForecast() {
  revalidatePath(FORECAST_SETTINGS_PATH)
  revalidatePath("/relatorios")
}

/** Grava as três etapas de uma vez (RPC set_proposal_stage_probabilities, só dono). */
export async function saveStageProbabilities(
  values: StageProbabilitiesValues
): Promise<FormActionResult<keyof StageProbabilitiesValues>> {
  const parsed = stageProbabilitiesSchema.safeParse(values)

  if (!parsed.success) {
    return {
      ok: false,
      error: INVALID_FIELDS_MESSAGE,
      fieldErrors: getFieldErrors<keyof StageProbabilitiesValues>(parsed.error),
    }
  }

  const auth = await getActionMembership(FORECAST_EDITOR_ROLES)

  if (!auth.ok) {
    return { ok: false, error: OWNER_ONLY_MESSAGE }
  }

  const supabase = await createClient()
  const { error } = await supabase.rpc("set_proposal_stage_probabilities", {
    p_organization_id: auth.context.membership.organizationId,
    p_draft: parsed.data.draft,
    p_sent: parsed.data.sent,
    p_countered: parsed.data.countered,
  })

  if (error) {
    return {
      ok: false,
      error:
        error.code === "42501"
          ? OWNER_ONLY_MESSAGE
          : translateDatabaseError(error, "Não foi possível salvar as probabilidades agora."),
    }
  }

  revalidateForecast()
  return {
    ok: true,
    message: "Probabilidades salvas. A previsão de vendas já usa os novos valores.",
  }
}

/**
 * Volta ao padrão apagando as linhas do dono: sem linha, o banco usa 10%, 30% e
 * 50% (e acompanha o padrão se ele mudar no futuro).
 */
export async function resetStageProbabilities(): Promise<ActionResult> {
  const auth = await getActionMembership(FORECAST_EDITOR_ROLES)

  if (!auth.ok) {
    return { ok: false, error: OWNER_ONLY_MESSAGE }
  }

  const supabase = await createClient()
  const { error } = await supabase
    .from("proposal_stage_probabilities")
    .delete()
    .eq("organization_id", auth.context.membership.organizationId)

  if (error) {
    return {
      ok: false,
      error: translateDatabaseError(error, "Não foi possível voltar ao padrão agora."),
    }
  }

  revalidateForecast()
  return { ok: true, message: "Probabilidades de volta ao padrão: 10%, 30% e 50%." }
}

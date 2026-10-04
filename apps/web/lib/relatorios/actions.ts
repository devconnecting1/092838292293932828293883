"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"

import { isDayKey } from "@workspace/core/reports/period"
import {
  isMonthKey,
  monthFirstDay,
  shiftMonth,
  formatMonthLabel,
} from "@workspace/core/reports/sales-goals"

import type { ActionResult } from "@/lib/auth/action-result"
import { requireMembership } from "@/lib/auth/session"
import { translateDbError } from "@/lib/propostas/db-errors"
import {
  goalFormToNumbers,
  saveGoalSchema,
  type SaveGoalInput,
} from "@/lib/relatorios/goal-schemas"
import { canEditGoals } from "@/lib/relatorios/permissions"
import { RELATORIOS_PATH } from "@/lib/relatorios/url"
import { createClient } from "@/lib/supabase/server"

/**
 * Ações da tela /relatorios. Quem pode é decidido no banco (`save_sales_goal`
 * e `copy_sales_goals` exigem dono ou gerente; a data prevista segue a
 * permissão de editar a proposta). A checagem de papel aqui só economiza a ida
 * ao banco e dá a mensagem certa.
 */

const NO_GOAL_PERMISSION = "Só o dono e o gerente definem metas."

export async function saveSalesGoal(input: SaveGoalInput): Promise<ActionResult> {
  const parsed = saveGoalSchema.safeParse(input)

  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Confira os campos." }
  }

  const { membership } = await requireMembership()

  if (!canEditGoals(membership.role)) {
    return { ok: false, error: NO_GOAL_PERMISSION }
  }

  const goal = goalFormToNumbers(parsed.data.values)
  const target =
    parsed.data.kind === "team"
      ? { p_team_id: parsed.data.targetId }
      : { p_user_id: parsed.data.targetId }

  // Indicador vazio vai como `undefined`, que some do JSON: o parâmetro da RPC
  // tem padrão null ("sem meta").
  const supabase = await createClient()
  const { data, error } = await supabase.rpc("save_sales_goal", {
    p_organization_id: membership.organizationId,
    p_month: monthFirstDay(parsed.data.month),
    ...target,
    p_leads_answered: goal.leadsAnswered ?? undefined,
    p_visits: goal.visits ?? undefined,
    p_proposals: goal.proposals ?? undefined,
    p_sales_count: goal.salesCount ?? undefined,
    p_sales_amount: goal.salesAmount ?? undefined,
    p_rentals_count: goal.rentalsCount ?? undefined,
    p_rentals_amount: goal.rentalsAmount ?? undefined,
  })

  if (error) {
    return { ok: false, error: translateDbError(error, NO_GOAL_PERMISSION) }
  }

  revalidatePath(RELATORIOS_PATH)

  return {
    ok: true,
    message: data ? "Meta salva." : "Meta removida: nenhum indicador ficou preenchido.",
  }
}

export async function copySalesGoalsFromPreviousMonth(month: string): Promise<ActionResult> {
  if (!isMonthKey(month)) {
    return { ok: false, error: "Mês inválido." }
  }

  const { membership } = await requireMembership()

  if (!canEditGoals(membership.role)) {
    return { ok: false, error: NO_GOAL_PERMISSION }
  }

  const previous = shiftMonth(month, -1)
  const supabase = await createClient()
  const { data, error } = await supabase.rpc("copy_sales_goals", {
    p_organization_id: membership.organizationId,
    p_from_month: monthFirstDay(previous),
    p_to_month: monthFirstDay(month),
  })

  if (error) {
    return { ok: false, error: translateDbError(error, NO_GOAL_PERMISSION) }
  }

  revalidatePath(RELATORIOS_PATH)

  const copied = typeof data === "number" ? data : 0

  if (copied === 0) {
    return {
      ok: true,
      message: `Nada copiado: ${formatMonthLabel(previous)} não tem metas que faltem neste mês.`,
    }
  }

  return {
    ok: true,
    message:
      copied === 1
        ? `1 meta copiada de ${formatMonthLabel(previous)}.`
        : `${copied} metas copiadas de ${formatMonthLabel(previous)}.`,
  }
}

const expectedCloseSchema = z.object({
  proposalId: z.guid("Proposta inválida."),
  date: z.string().refine(isDayKey, "Escolha uma data válida."),
})

export async function setProposalExpectedCloseDate(
  proposalId: string,
  date: string
): Promise<ActionResult> {
  const parsed = expectedCloseSchema.safeParse({ proposalId, date })

  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Confira a data." }
  }

  const { membership } = await requireMembership()
  const supabase = await createClient()
  const { error } = await supabase.rpc("set_proposal_expected_close_date", {
    p_organization_id: membership.organizationId,
    p_proposal_id: parsed.data.proposalId,
    p_expected_close_date: parsed.data.date,
  })

  if (error) {
    return {
      ok: false,
      error: translateDbError(error, "Seu papel não permite editar esta proposta."),
    }
  }

  revalidatePath(RELATORIOS_PATH)
  revalidatePath("/propostas")

  return { ok: true, message: "Data prevista salva." }
}

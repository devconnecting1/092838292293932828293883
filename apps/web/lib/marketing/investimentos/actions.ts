"use server"

import { revalidatePath } from "next/cache"

import {
  centsToReais,
  formatMonthLabel,
  investmentKey,
  monthKeyToDate,
  normalizeCampaign,
} from "@workspace/core/reports/marketing-investments"

import type { ActionResult } from "@/lib/auth/action-result"
import { INVALID_FIELDS_MESSAGE } from "@/lib/clientes/action-result"
import { parseBrlCents } from "@/lib/comissoes/money"
import { getActionMembership, type FormActionResult } from "@/lib/configuracoes/action-context"
import { PERMISSION_DENIED_MESSAGE, translateDatabaseError } from "@/lib/configuracoes/errors"
import { getFieldErrors } from "@/lib/configuracoes/schemas"
import { LEAD_SOURCE_LABELS } from "@/lib/leads/constants"
import {
  MARKETING_INVESTMENT_EDITOR_ROLES,
  MARKETING_INVESTMENTS_PATH,
} from "@/lib/marketing/investimentos/constants"
import {
  investmentIdSchema,
  investmentSchema,
  type InvestmentValues,
} from "@/lib/marketing/investimentos/schemas"
import { createClient } from "@/lib/supabase/server"

// Toda action confere o papel (dono ou gerente) antes do banco; o RLS e a RPC
// repetem a regra. A imobiliária vem da sessão, nunca do formulário.

const DUPLICATE_MESSAGE =
  "Já existe um lançamento para este mês, canal e campanha. Edite o que está na lista."
const NOT_FOUND_MESSAGE = "Este lançamento não existe mais. Atualize a página."

type DatabaseErrorLike = { code?: string; message: string; details?: string | null }

function translateInvestmentError(error: DatabaseErrorLike) {
  if (error.code === "23505") {
    return DUPLICATE_MESSAGE
  }

  if (error.code === "23514") {
    const text = error.message ?? ""

    if (text.includes("campaign")) return "A campanha pode ter no máximo 200 caracteres."
    if (text.includes("amount")) return "O valor precisa ser zero ou maior."
    if (text.includes("month")) return "Escolha um mês entre 2000 e 2099."
    if (text.includes("notes")) return "A observação pode ter no máximo 500 caracteres."
  }

  return translateDatabaseError(error, "Não foi possível salvar o investimento agora.")
}

function revalidateInvestments() {
  revalidatePath(MARKETING_INVESTMENTS_PATH)
  revalidatePath("/relatorios")
}

export async function saveMarketingInvestment(
  values: InvestmentValues
): Promise<FormActionResult<keyof InvestmentValues>> {
  const parsed = investmentSchema.safeParse(values)

  if (!parsed.success) {
    return {
      ok: false,
      error: INVALID_FIELDS_MESSAGE,
      fieldErrors: getFieldErrors<keyof InvestmentValues>(parsed.error),
    }
  }

  const auth = await getActionMembership(MARKETING_INVESTMENT_EDITOR_ROLES)

  if (!auth.ok) {
    return auth
  }

  const organizationId = auth.context.membership.organizationId
  const data = parsed.data
  const amountCents = parseBrlCents(data.amount) ?? 0
  const campaign = normalizeCampaign(data.campaign)
  const month = monthKeyToDate(data.month)
  const notes = data.notes.trim() || null
  const supabase = await createClient()

  // Outro lançamento com a mesma chave (mês + canal + campanha sem maiúsculas)?
  const { data: sameMonth, error: lookupError } = await supabase
    .from("marketing_investments")
    .select("id, utm_campaign")
    .eq("organization_id", organizationId)
    .eq("month", month)
    .eq("source", data.source)

  if (lookupError) {
    return { ok: false, error: translateInvestmentError(lookupError) }
  }

  const key = investmentKey({ month: data.month, source: data.source, campaign })
  const clash = (sameMonth ?? []).find(
    (row) =>
      row.id !== data.id &&
      investmentKey({ month: data.month, source: data.source, campaign: row.utm_campaign }) === key
  )

  const label = `${LEAD_SOURCE_LABELS[data.source]} em ${formatMonthLabel(data.month)}`

  if (data.id) {
    if (clash) {
      return { ok: false, error: DUPLICATE_MESSAGE, fieldErrors: { campaign: DUPLICATE_MESSAGE } }
    }

    const { data: updated, error } = await supabase
      .from("marketing_investments")
      .update({
        month,
        source: data.source,
        utm_campaign: campaign,
        amount: centsToReais(amountCents),
        notes,
      })
      .eq("organization_id", organizationId)
      .eq("id", data.id)
      .select("id")

    if (error) {
      const message = translateInvestmentError(error)
      return error.code === "23505"
        ? { ok: false, error: message, fieldErrors: { campaign: message } }
        : { ok: false, error: message }
    }

    if (!updated?.length) {
      return { ok: false, error: NOT_FOUND_MESSAGE }
    }

    revalidateInvestments()
    return { ok: true, message: `Investimento de ${label} atualizado.` }
  }

  // Lançamento novo pela RPC (grava ou substitui a mesma combinação).
  const { error } = await supabase.rpc("save_marketing_investment", {
    p_organization_id: organizationId,
    p_month: month,
    p_source: data.source,
    p_utm_campaign: campaign ?? "",
    p_amount: centsToReais(amountCents),
    p_notes: notes ?? "",
  })

  if (error) {
    return {
      ok: false,
      error: error.code === "42501" ? PERMISSION_DENIED_MESSAGE : translateInvestmentError(error),
    }
  }

  revalidateInvestments()
  return {
    ok: true,
    message: clash
      ? `Já havia um lançamento de ${label}${campaign ? ` na campanha "${campaign}"` : ""}: o valor foi substituído.`
      : `Investimento de ${label} lançado.`,
  }
}

export async function deleteMarketingInvestment(id: string): Promise<ActionResult> {
  const parsedId = investmentIdSchema.safeParse(id)

  if (!parsedId.success) {
    return { ok: false, error: "Lançamento inválido." }
  }

  const auth = await getActionMembership(MARKETING_INVESTMENT_EDITOR_ROLES)

  if (!auth.ok) {
    return auth
  }

  const supabase = await createClient()
  const { data, error } = await supabase
    .from("marketing_investments")
    .delete()
    .eq("organization_id", auth.context.membership.organizationId)
    .eq("id", parsedId.data)
    .select("id")

  if (error) {
    return {
      ok: false,
      error: translateDatabaseError(error, "Não foi possível excluir o lançamento agora."),
    }
  }

  if (!data?.length) {
    return { ok: false, error: NOT_FOUND_MESSAGE }
  }

  revalidateInvestments()
  return { ok: true, message: "Lançamento excluído. O custo por lead do período é recalculado." }
}

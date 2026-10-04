"use server"

import { revalidatePath } from "next/cache"

import type { ActionResult } from "@/lib/auth/action-result"
import { HOME_PATH } from "@/lib/auth/routes"
import { INVALID_FIELDS_MESSAGE } from "@/lib/clientes/action-result"
import {
  COMMISSION_MANAGER_ROLES,
  COMMISSION_SETTINGS_PATH,
  COMMISSIONS_PATH,
} from "@/lib/comissoes/permissions"
import { parseBrlCents } from "@/lib/comissoes/money"
import {
  commissionPartnerSchema,
  commissionRuleSchema,
  commissionSettingsSchema,
  discountRequestSchema,
  discountReviewSchema,
  payShareSchema,
  type CommissionPartnerValues,
  type CommissionRuleValues,
  type CommissionSettingsValues,
  type DiscountRequestValues,
  type DiscountReviewValues,
  type PayShareValues,
} from "@/lib/comissoes/schemas"
import { getActionMembership, type FormActionResult } from "@/lib/configuracoes/action-context"
import { PERMISSION_DENIED_MESSAGE, translateDatabaseError } from "@/lib/configuracoes/errors"
import { getFieldErrors } from "@/lib/configuracoes/schemas"
import { createClient } from "@/lib/supabase/server"

const PROPOSALS_PATH = "/propostas"

function revalidateCommissions() {
  revalidatePath(COMMISSIONS_PATH)
  revalidatePath(COMMISSION_SETTINGS_PATH)
  revalidatePath(HOME_PATH)
}

// ---------------------------------------------------------------------------
// Tabela de comissão (versionada: gravar cria uma versão nova)
// ---------------------------------------------------------------------------

export async function saveCommissionRule(
  values: CommissionRuleValues
): Promise<FormActionResult<keyof CommissionRuleValues>> {
  const parsed = commissionRuleSchema.safeParse(values)

  if (!parsed.success) {
    return {
      ok: false,
      error: INVALID_FIELDS_MESSAGE,
      fieldErrors: getFieldErrors<keyof CommissionRuleValues>(parsed.error),
    }
  }

  const auth = await getActionMembership(COMMISSION_MANAGER_ROLES)

  if (!auth.ok) {
    return auth
  }

  const data = parsed.data
  const fixedCents = data.basis === "fixed" ? (parseBrlCents(data.fixedAmount) ?? 0) : 0
  const supabase = await createClient()

  // INSERT, nunca UPDATE: o gatilho fecha a versão anterior com effective_to e
  // o negócio fechado no mês passado continua com a regra daquele mês.
  const { data: saved, error } = await supabase
    .from("commission_rules")
    .insert({
      organization_id: auth.context.membership.organizationId,
      purpose: data.purpose,
      basis: data.basis,
      percent: data.basis === "percent" ? data.percent : 0,
      fixed_cents: fixedCents,
      capturer_percent: data.capturerPercent,
      seller_percent: data.sellerPercent,
      manager_percent: data.managerPercent,
      agency_percent: data.agencyPercent,
      partner_percent: data.partnerPercent,
      note: data.note || null,
    })
    .select("id")

  if (error) {
    if (error.code === "23514" && (error.message ?? "").includes("split_closes")) {
      return {
        ok: false,
        error: "A divisão precisa somar exatamente 100%.",
        fieldErrors: { agencyPercent: "A divisão precisa somar exatamente 100%." },
      }
    }

    return { ok: false, error: translateDatabaseError(error) }
  }

  if (!saved?.length) {
    return { ok: false, error: PERMISSION_DENIED_MESSAGE }
  }

  revalidateCommissions()

  return {
    ok: true,
    message:
      "Tabela de comissão salva. A anterior virou histórico e segue valendo para os negócios já fechados.",
  }
}

export async function saveCommissionSettings(
  values: CommissionSettingsValues
): Promise<FormActionResult<keyof CommissionSettingsValues>> {
  const parsed = commissionSettingsSchema.safeParse(values)

  if (!parsed.success) {
    return {
      ok: false,
      error: INVALID_FIELDS_MESSAGE,
      fieldErrors: getFieldErrors<keyof CommissionSettingsValues>(parsed.error),
    }
  }

  const auth = await getActionMembership(COMMISSION_MANAGER_ROLES)

  if (!auth.ok) {
    return auth
  }

  const data = parsed.data
  const supabase = await createClient()
  const { data: saved, error } = await supabase
    .from("commission_settings")
    .upsert(
      {
        organization_id: auth.context.membership.organizationId,
        manager_user_id: data.managerUserId || null,
        discount_approval_enabled: data.discountApprovalEnabled,
        max_discount_percent: data.maxDiscountPercent,
      },
      { onConflict: "organization_id" }
    )
    .select("organization_id")

  if (error) {
    if (error.code === "23514" && (error.message ?? "").includes("membro ativo")) {
      return {
        ok: false,
        error: translateDatabaseError(error),
        fieldErrors: { managerUserId: "Escolha alguém que esteja ativo na equipe." },
      }
    }

    return { ok: false, error: translateDatabaseError(error) }
  }

  if (!saved?.length) {
    return { ok: false, error: PERMISSION_DENIED_MESSAGE }
  }

  revalidateCommissions()
  revalidatePath(PROPOSALS_PATH)

  return {
    ok: true,
    message: data.discountApprovalEnabled
      ? `Salvo. Desconto acima de ${data.maxDiscountPercent}% passa a precisar da aprovação do gerente.`
      : "Salvo. A aprovação de desconto segue desligada.",
  }
}

// ---------------------------------------------------------------------------
// Pagamento das partes
// ---------------------------------------------------------------------------

const NO_PAYMENT_PERMISSION =
  "Só o dono, o gerente ou o financeiro da imobiliária marca comissão como paga."

export async function payCommissionShare(
  values: PayShareValues
): Promise<FormActionResult<keyof PayShareValues>> {
  const parsed = payShareSchema.safeParse(values)

  if (!parsed.success) {
    return {
      ok: false,
      error: INVALID_FIELDS_MESSAGE,
      fieldErrors: getFieldErrors<keyof PayShareValues>(parsed.error),
    }
  }

  const auth = await getActionMembership()

  if (!auth.ok) {
    return auth
  }

  const data = parsed.data
  // Data sem hora vira meio-dia local, para não cair no dia anterior no fuso.
  const paidAt = data.paidOn
    ? new Date(`${data.paidOn}T12:00:00`).toISOString()
    : new Date().toISOString()
  const supabase = await createClient()
  const { data: saved, error } = await supabase
    .from("commission_shares")
    .update({ paid_at: paidAt, paid_note: data.note || null })
    .eq("id", data.shareId)
    .eq("organization_id", auth.context.membership.organizationId)
    .select("id")

  if (error) {
    return { ok: false, error: translateDatabaseError(error, NO_PAYMENT_PERMISSION) }
  }

  if (!saved?.length) {
    return { ok: false, error: NO_PAYMENT_PERMISSION }
  }

  revalidateCommissions()

  return { ok: true, message: "Parte marcada como paga." }
}

export async function reopenCommissionShare(shareId: string): Promise<ActionResult> {
  const auth = await getActionMembership()

  if (!auth.ok) {
    return auth
  }

  const supabase = await createClient()
  const { data: saved, error } = await supabase
    .from("commission_shares")
    .update({ paid_at: null, paid_note: null })
    .eq("id", shareId)
    .eq("organization_id", auth.context.membership.organizationId)
    .select("id")

  if (error) {
    return { ok: false, error: translateDatabaseError(error, NO_PAYMENT_PERMISSION) }
  }

  if (!saved?.length) {
    return { ok: false, error: NO_PAYMENT_PERMISSION }
  }

  revalidateCommissions()

  return { ok: true, message: "Pagamento desfeito: a parte voltou para 'a receber'." }
}

export async function setCommissionPartner(
  values: CommissionPartnerValues
): Promise<FormActionResult<keyof CommissionPartnerValues>> {
  const parsed = commissionPartnerSchema.safeParse(values)

  if (!parsed.success) {
    return {
      ok: false,
      error: INVALID_FIELDS_MESSAGE,
      fieldErrors: getFieldErrors<keyof CommissionPartnerValues>(parsed.error),
    }
  }

  const auth = await getActionMembership(COMMISSION_MANAGER_ROLES)

  if (!auth.ok) {
    return auth
  }

  const data = parsed.data
  const supabase = await createClient()
  const { error } = await supabase.rpc("set_commission_partner", {
    p_commission_id: data.commissionId,
    p_partner_name: data.partnerName || undefined,
    p_percent: data.percent,
  })

  if (error) {
    return { ok: false, error: translateDatabaseError(error) }
  }

  revalidateCommissions()

  return {
    ok: true,
    message: data.partnerName
      ? "Parceiro registrado. A parte dele saiu da fatia da imobiliária."
      : "Parceiro removido. O valor voltou para a imobiliária.",
  }
}

export async function cancelCommission(
  commissionId: string,
  canceled: boolean
): Promise<ActionResult> {
  const auth = await getActionMembership(COMMISSION_MANAGER_ROLES)

  if (!auth.ok) {
    return auth
  }

  const supabase = await createClient()
  const { data: saved, error } = await supabase
    .from("commissions")
    .update({ status: canceled ? "canceled" : "pending" })
    .eq("id", commissionId)
    .eq("organization_id", auth.context.membership.organizationId)
    .select("id")

  if (error) {
    return { ok: false, error: translateDatabaseError(error) }
  }

  if (!saved?.length) {
    return { ok: false, error: PERMISSION_DENIED_MESSAGE }
  }

  revalidateCommissions()

  return {
    ok: true,
    message: canceled ? "Comissão cancelada." : "Comissão reaberta.",
  }
}

// ---------------------------------------------------------------------------
// Aprovação de desconto
// ---------------------------------------------------------------------------

export async function requestProposalDiscount(
  values: DiscountRequestValues
): Promise<FormActionResult<keyof DiscountRequestValues>> {
  const parsed = discountRequestSchema.safeParse(values)

  if (!parsed.success) {
    return {
      ok: false,
      error: INVALID_FIELDS_MESSAGE,
      fieldErrors: getFieldErrors<keyof DiscountRequestValues>(parsed.error),
    }
  }

  const auth = await getActionMembership()

  if (!auth.ok) {
    return auth
  }

  const supabase = await createClient()
  const { error } = await supabase.rpc("request_proposal_discount", {
    p_proposal_id: parsed.data.proposalId,
    p_reason: parsed.data.reason || undefined,
  })

  if (error) {
    return { ok: false, error: translateDatabaseError(error) }
  }

  revalidateCommissions()
  revalidatePath(PROPOSALS_PATH)

  return { ok: true, message: "Pedido enviado. O gerente vê o desconto em Comissões." }
}

export async function reviewProposalDiscount(
  values: DiscountReviewValues
): Promise<FormActionResult<keyof DiscountReviewValues>> {
  const parsed = discountReviewSchema.safeParse(values)

  if (!parsed.success) {
    return {
      ok: false,
      error: INVALID_FIELDS_MESSAGE,
      fieldErrors: getFieldErrors<keyof DiscountReviewValues>(parsed.error),
    }
  }

  const auth = await getActionMembership(COMMISSION_MANAGER_ROLES)

  if (!auth.ok) {
    return auth
  }

  const supabase = await createClient()
  const { error } = await supabase.rpc("review_proposal_discount", {
    p_request_id: parsed.data.requestId,
    p_approve: parsed.data.approve,
    p_note: parsed.data.note || undefined,
  })

  if (error) {
    return { ok: false, error: translateDatabaseError(error) }
  }

  revalidateCommissions()
  revalidatePath(PROPOSALS_PATH)

  return {
    ok: true,
    message: parsed.data.approve
      ? "Desconto aprovado. A proposta já pode seguir."
      : "Desconto recusado.",
  }
}

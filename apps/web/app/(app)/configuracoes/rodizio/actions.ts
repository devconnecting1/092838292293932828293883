"use server"

import { revalidatePath } from "next/cache"

import type { ActionResult } from "@/lib/auth/action-result"
import { TEAM_MANAGER_ROLES } from "@/lib/auth/roles"
import {
  INVALID_FIELDS_MESSAGE,
  toFieldErrors,
  type ActionResultWithData,
} from "@/lib/clientes/action-result"
import { getActionMembership, type FormActionResult } from "@/lib/configuracoes/action-context"
import { PERMISSION_DENIED_MESSAGE, translateDatabaseError } from "@/lib/configuracoes/errors"
import { getFieldErrors } from "@/lib/configuracoes/schemas"
import {
  bulkReassignSchema,
  describeBulkReassign,
  leadRoutingMemberSchema,
  leadRoutingSettingsSchema,
  leadRoutingShiftSchema,
  parseBulkReassignResult,
  toIsoOrNull,
  type BulkReassignSummary,
  type BulkReassignValues,
  type LeadRoutingMemberValues,
  type LeadRoutingSettingsValues,
  type LeadRoutingShiftValues,
} from "@/lib/leads/routing"
import { createClient } from "@/lib/supabase/server"

const PAGE_PATH = "/configuracoes/rodizio"
const LEADS_PATH = "/leads"

type DatabaseErrorLike = { code?: string; message: string }

function mentions(error: DatabaseErrorLike, needle: string) {
  return (error.message ?? "").toLowerCase().includes(needle.toLowerCase())
}

// -----------------------------------------------------------------------------
// Configuração do rodízio e do prazo de primeiro contato
// -----------------------------------------------------------------------------

export async function saveLeadRoutingSettings(
  values: LeadRoutingSettingsValues
): Promise<FormActionResult<keyof LeadRoutingSettingsValues>> {
  const parsed = leadRoutingSettingsSchema.safeParse(values)

  if (!parsed.success) {
    return {
      ok: false,
      error: INVALID_FIELDS_MESSAGE,
      fieldErrors: getFieldErrors<keyof LeadRoutingSettingsValues>(parsed.error),
    }
  }

  const auth = await getActionMembership(TEAM_MANAGER_ROLES)

  if (!auth.ok) {
    return auth
  }

  const data = parsed.data
  const supabase = await createClient()
  // Não existe linha por padrão: a primeira gravação cria a configuração.
  const { data: saved, error } = await supabase
    .from("lead_routing_settings")
    .upsert(
      {
        organization_id: auth.context.membership.organizationId,
        roulette_enabled: data.rouletteEnabled,
        respect_schedule: data.respectSchedule,
        fallback_to_page_assignee: data.fallbackToPageAssignee,
        sla_minutes: data.slaMinutes,
        sla_reassign_enabled: data.slaReassignEnabled,
        sla_warning_percent: data.slaWarningPercent,
        max_reassignments: data.maxReassignments,
        time_zone: data.timeZone,
      },
      { onConflict: "organization_id" }
    )
    .select("organization_id")

  if (error) {
    if (error.code === "23514" && mentions(error, "fuso")) {
      return {
        ok: false,
        error: "Fuso horário inválido.",
        fieldErrors: { timeZone: "Escolha um fuso horário da lista." },
      }
    }

    return { ok: false, error: translateDatabaseError(error) }
  }

  // Com RLS, uma gravação sem permissão pode não alterar nenhuma linha.
  if (!saved?.length) {
    return { ok: false, error: PERMISSION_DENIED_MESSAGE }
  }

  revalidatePath(PAGE_PATH)

  return {
    ok: true,
    message: data.rouletteEnabled
      ? "Rodízio salvo. Os próximos leads entram na fila."
      : "Configuração salva. O rodízio segue desligado.",
  }
}

// -----------------------------------------------------------------------------
// Fila do rodízio
// -----------------------------------------------------------------------------

export async function saveLeadRoutingMember(
  values: LeadRoutingMemberValues
): Promise<FormActionResult<keyof LeadRoutingMemberValues>> {
  const parsed = leadRoutingMemberSchema.safeParse(values)

  if (!parsed.success) {
    return {
      ok: false,
      error: INVALID_FIELDS_MESSAGE,
      fieldErrors: getFieldErrors<keyof LeadRoutingMemberValues>(parsed.error),
    }
  }

  const auth = await getActionMembership(TEAM_MANAGER_ROLES)

  if (!auth.ok) {
    return auth
  }

  const data = parsed.data
  const organizationId = auth.context.membership.organizationId
  const supabase = await createClient()
  // last_assigned_at é do banco (estado de justiça do rodízio): nunca gravamos.
  const editable = {
    active: data.active,
    weight: data.weight,
    daily_limit: data.dailyLimit,
    away_from: toIsoOrNull(data.awayFrom),
    away_until: toIsoOrNull(data.awayUntil),
  }

  const { data: saved, error } = data.id
    ? await supabase
        .from("lead_routing_members")
        .update(editable)
        .eq("id", data.id)
        .eq("organization_id", organizationId)
        .select("id")
    : await supabase
        .from("lead_routing_members")
        .insert({ organization_id: organizationId, user_id: data.userId, ...editable })
        .select("id")

  if (error) {
    if (error.code === "23505") {
      return {
        ok: false,
        error: "Este corretor já está na fila do rodízio.",
        fieldErrors: { userId: "Este corretor já está na fila." },
      }
    }

    if (error.code === "23514") {
      if (mentions(error, "away_range")) {
        return {
          ok: false,
          error: INVALID_FIELDS_MESSAGE,
          fieldErrors: { awayUntil: "A volta precisa ser depois da saída." },
        }
      }

      if (mentions(error, "membro ativo")) {
        return {
          ok: false,
          error: translateDatabaseError(error),
          fieldErrors: { userId: "Escolha alguém que esteja ativo na equipe." },
        }
      }
    }

    return { ok: false, error: translateDatabaseError(error) }
  }

  if (!saved?.length) {
    return { ok: false, error: PERMISSION_DENIED_MESSAGE }
  }

  revalidatePath(PAGE_PATH)

  return {
    ok: true,
    message: data.id ? "Corretor atualizado na fila." : "Corretor adicionado à fila.",
  }
}

export async function removeLeadRoutingMember(id: string): Promise<ActionResult> {
  const auth = await getActionMembership(TEAM_MANAGER_ROLES)

  if (!auth.ok) {
    return auth
  }

  const supabase = await createClient()
  // As janelas de plantão saem junto (on delete cascade).
  const { data: removed, error } = await supabase
    .from("lead_routing_members")
    .delete()
    .eq("id", id)
    .eq("organization_id", auth.context.membership.organizationId)
    .select("id")

  if (error) {
    return { ok: false, error: translateDatabaseError(error) }
  }

  if (!removed?.length) {
    return { ok: false, error: PERMISSION_DENIED_MESSAGE }
  }

  revalidatePath(PAGE_PATH)

  return { ok: true, message: "Corretor retirado da fila. Os leads dele continuam com ele." }
}

// -----------------------------------------------------------------------------
// Escala de plantão
// -----------------------------------------------------------------------------

export async function addLeadRoutingShift(
  memberId: string,
  values: LeadRoutingShiftValues
): Promise<FormActionResult<keyof LeadRoutingShiftValues>> {
  const parsed = leadRoutingShiftSchema.safeParse(values)

  if (!parsed.success) {
    return {
      ok: false,
      error: INVALID_FIELDS_MESSAGE,
      fieldErrors: getFieldErrors<keyof LeadRoutingShiftValues>(parsed.error),
    }
  }

  const auth = await getActionMembership(TEAM_MANAGER_ROLES)

  if (!auth.ok) {
    return auth
  }

  const organizationId = auth.context.membership.organizationId
  const supabase = await createClient()
  // Confere que a janela é desta imobiliária antes de gravar (a FK é composta).
  const { data: member, error: memberError } = await supabase
    .from("lead_routing_members")
    .select("id")
    .eq("id", memberId)
    .eq("organization_id", organizationId)
    .maybeSingle()

  if (memberError) {
    return { ok: false, error: translateDatabaseError(memberError) }
  }

  if (!member) {
    return { ok: false, error: "Este corretor não está na fila do rodízio." }
  }

  const { data: saved, error } = await supabase
    .from("lead_routing_shifts")
    .insert({
      organization_id: organizationId,
      member_id: member.id,
      weekday: parsed.data.weekday,
      start_minute: parsed.data.startMinute,
      end_minute: parsed.data.endMinute,
    })
    .select("id")

  if (error) {
    if (error.code === "23505") {
      return {
        ok: false,
        error: "Essa janela já existe para este corretor.",
        fieldErrors: { startMinute: "Essa janela já existe para este corretor." },
      }
    }

    // 23514 traz a mensagem do gatilho (ex.: teto de 21 janelas por corretor).
    return { ok: false, error: translateDatabaseError(error) }
  }

  if (!saved?.length) {
    return { ok: false, error: PERMISSION_DENIED_MESSAGE }
  }

  revalidatePath(PAGE_PATH)

  return { ok: true, message: "Janela de plantão adicionada." }
}

export async function removeLeadRoutingShift(id: string): Promise<ActionResult> {
  const auth = await getActionMembership(TEAM_MANAGER_ROLES)

  if (!auth.ok) {
    return auth
  }

  const supabase = await createClient()
  const { data: removed, error } = await supabase
    .from("lead_routing_shifts")
    .delete()
    .eq("id", id)
    .eq("organization_id", auth.context.membership.organizationId)
    .select("id")

  if (error) {
    return { ok: false, error: translateDatabaseError(error) }
  }

  if (!removed?.length) {
    return { ok: false, error: PERMISSION_DENIED_MESSAGE }
  }

  revalidatePath(PAGE_PATH)

  return { ok: true, message: "Janela de plantão removida." }
}

// -----------------------------------------------------------------------------
// Reatribuição em massa (quando um corretor sai)
// -----------------------------------------------------------------------------

export async function reassignLeadsInBulk(
  values: BulkReassignValues
): Promise<ActionResultWithData<BulkReassignSummary>> {
  const parsed = bulkReassignSchema.safeParse(values)

  if (!parsed.success) {
    return { ok: false, error: INVALID_FIELDS_MESSAGE, fieldErrors: toFieldErrors(parsed.error) }
  }

  const auth = await getActionMembership(TEAM_MANAGER_ROLES)

  if (!auth.ok) {
    return auth
  }

  const data = parsed.data
  const supabase = await createClient()
  const { data: result, error } = await supabase.rpc("bulk_reassign_leads", {
    p_organization_id: auth.context.membership.organizationId,
    p_from_user_id: data.fromUserId,
    // Sem destino: o banco devolve os leads para a roleta.
    p_to_user_id: data.toUserId ?? undefined,
    p_include_closed: data.includeClosed,
  })

  if (error) {
    if (error.code === "42501") {
      return { ok: false, error: PERMISSION_DENIED_MESSAGE }
    }

    if (error.code === "23514") {
      return {
        ok: false,
        error: translateDatabaseError(error),
        fieldErrors: { toUserId: "Escolha alguém que esteja ativo na equipe." },
      }
    }

    if (error.code === "22023") {
      return {
        ok: false,
        error: translateDatabaseError(error),
        fieldErrors: { toUserId: "Escolha um responsável diferente do atual." },
      }
    }

    return { ok: false, error: translateDatabaseError(error) }
  }

  const summary = parseBulkReassignResult(result)

  revalidatePath(PAGE_PATH)
  revalidatePath(LEADS_PATH)

  return { ok: true, data: summary, message: describeBulkReassign(summary) }
}

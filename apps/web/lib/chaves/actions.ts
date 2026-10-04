"use server"

import { revalidatePath } from "next/cache"
import type { z } from "zod"

import type { ActionResult } from "@/lib/auth/action-result"
import { requireMembership } from "@/lib/auth/session"
import { localInputToIso } from "@/lib/chaves/datetime"
import { describeTaker, type KeyTakerKind } from "@/lib/chaves/queries"
import {
  keyCheckoutSchema,
  keyCreateSchema,
  keyIdSchema,
  keyUpdateSchema,
  type KeyCheckoutValues,
  type KeyCreateValues,
  type KeyUpdateValues,
} from "@/lib/chaves/schemas"
import { translateDbError } from "@/lib/propostas/db-errors"
import { getProfileNames } from "@/lib/propostas/options"
import { COMMERCIAL_ROLES } from "@/lib/propostas/permissions"
import { createClient } from "@/lib/supabase/server"

function firstIssue(error: z.ZodError) {
  return error.issues[0]?.message ?? "Confira os campos destacados."
}

function revalidateKeys() {
  revalidatePath("/chaves")
  revalidatePath("/imoveis", "layout")
}

const NO_EDIT_PERMISSION =
  "Você não tem permissão para alterar esta chave. Só quem edita o imóvel pode fazer isso."

export async function createKey(values: KeyCreateValues): Promise<ActionResult> {
  const parsed = keyCreateSchema.safeParse(values)

  if (!parsed.success) {
    return { ok: false, error: firstIssue(parsed.error) }
  }

  const { membership } = await requireMembership()
  const supabase = await createClient()
  const { propertyId, label, location, notes } = parsed.data

  const { error } = await supabase.from("keys").insert({
    organization_id: membership.organizationId,
    property_id: propertyId,
    label,
    location: location || null,
    notes: notes || null,
  })

  if (error) {
    return {
      ok: false,
      error:
        error.code === "23503"
          ? "Imóvel não encontrado. Recarregue a página."
          : translateDbError(error, "Você não tem permissão para cadastrar chaves neste imóvel."),
    }
  }

  revalidateKeys()
  return { ok: true, message: "Chave cadastrada." }
}

export async function updateKey(keyId: string, values: KeyUpdateValues): Promise<ActionResult> {
  const id = keyIdSchema.safeParse(keyId)
  const parsed = keyUpdateSchema.safeParse(values)

  if (!id.success) return { ok: false, error: "Chave inválida." }
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) }

  const { membership } = await requireMembership()
  const supabase = await createClient()
  const { label, location, notes } = parsed.data

  const { data, error } = await supabase
    .from("keys")
    .update({ label, location: location || null, notes: notes || null })
    .eq("id", id.data)
    .eq("organization_id", membership.organizationId)
    .select("id")

  if (error) {
    return { ok: false, error: translateDbError(error, NO_EDIT_PERMISSION) }
  }

  if (data.length === 0) {
    return { ok: false, error: NO_EDIT_PERMISSION }
  }

  revalidateKeys()
  return { ok: true, message: "Chave atualizada." }
}

export async function checkoutKey(keyId: string, values: KeyCheckoutValues): Promise<ActionResult> {
  const id = keyIdSchema.safeParse(keyId)
  const parsed = keyCheckoutSchema.safeParse(values)

  if (!id.success) return { ok: false, error: "Chave inválida." }
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) }

  const { membership } = await requireMembership()

  if (!COMMERCIAL_ROLES.includes(membership.role)) {
    return {
      ok: false,
      error: "Você não tem permissão para registrar retirada de chaves.",
    }
  }

  const supabase = await createClient()
  const organizationId = membership.organizationId
  const { takerKind, memberId, clientId, dueAt, notes } = parsed.data

  const { data: key, error: keyError } = await supabase
    .from("keys")
    .select("id, status")
    .eq("id", id.data)
    .eq("organization_id", organizationId)
    .maybeSingle()

  if (keyError) {
    return {
      ok: false,
      error: translateDbError(keyError, "Você não tem acesso a esta chave."),
    }
  }

  if (!key) return { ok: false, error: "Chave não encontrada. Recarregue a página." }
  if (key.status === "lost") return { ok: false, error: "Esta chave está marcada como perdida." }
  if (key.status === "checked_out") return { ok: false, error: "Esta chave já está retirada." }

  if (takerKind === "member") {
    const { data: member, error: memberError } = await supabase
      .from("memberships")
      .select("user_id")
      .eq("organization_id", organizationId)
      .eq("user_id", memberId)
      .eq("active", true)
      .maybeSingle()

    if (memberError || !member) {
      return { ok: false, error: "Selecione um membro ativo da equipe." }
    }
  }

  const { error } = await supabase.from("key_movements").insert({
    organization_id: organizationId,
    key_id: id.data,
    taken_by_user: takerKind === "member" ? memberId : null,
    taken_by_client_id: takerKind === "client" ? clientId : null,
    due_at: localInputToIso(dueAt),
    notes: notes || null,
  })

  if (error) {
    return {
      ok: false,
      error:
        error.code === "23505"
          ? "Esta chave já está retirada."
          : error.code === "23503"
            ? "Cliente não encontrado. Recarregue a página."
            : translateDbError(error, "Você não tem permissão para registrar retirada de chaves."),
    }
  }

  revalidateKeys()
  return { ok: true, message: "Retirada registrada." }
}

export async function returnKey(keyId: string): Promise<ActionResult> {
  const id = keyIdSchema.safeParse(keyId)

  if (!id.success) return { ok: false, error: "Chave inválida." }

  const { membership } = await requireMembership()
  const supabase = await createClient()
  const noPermission =
    "Você não tem permissão para registrar esta devolução. Peça a quem retirou a chave ou ao responsável pelo imóvel."

  const { data, error } = await supabase
    .from("key_movements")
    .update({ returned_at: new Date().toISOString() })
    .eq("key_id", id.data)
    .eq("organization_id", membership.organizationId)
    .is("returned_at", null)
    .select("id")

  if (error) {
    return { ok: false, error: translateDbError(error, noPermission) }
  }

  if (data.length === 0) {
    const { count } = await supabase
      .from("key_movements")
      .select("id", { count: "exact", head: true })
      .eq("key_id", id.data)
      .eq("organization_id", membership.organizationId)
      .is("returned_at", null)

    return {
      ok: false,
      error: count ? noPermission : "Esta chave já foi devolvida. Recarregue a página.",
    }
  }

  revalidateKeys()
  return { ok: true, message: "Devolução registrada." }
}

export async function markKeyLost(keyId: string): Promise<ActionResult> {
  const id = keyIdSchema.safeParse(keyId)

  if (!id.success) return { ok: false, error: "Chave inválida." }

  const { membership } = await requireMembership()
  const supabase = await createClient()

  const { data, error } = await supabase
    .from("keys")
    .update({ status: "lost" })
    .eq("id", id.data)
    .eq("organization_id", membership.organizationId)
    .select("id")

  if (error) return { ok: false, error: translateDbError(error, NO_EDIT_PERMISSION) }
  if (data.length === 0) return { ok: false, error: NO_EDIT_PERMISSION }

  revalidateKeys()
  return { ok: true, message: "Chave marcada como perdida." }
}

/** Desfaz "perdida": volta a disponível, ou a retirada se ainda houver retirada em aberto. */
export async function markKeyFound(keyId: string): Promise<ActionResult> {
  const id = keyIdSchema.safeParse(keyId)

  if (!id.success) return { ok: false, error: "Chave inválida." }

  const { membership } = await requireMembership()
  const supabase = await createClient()

  const { count, error: countError } = await supabase
    .from("key_movements")
    .select("id", { count: "exact", head: true })
    .eq("key_id", id.data)
    .eq("organization_id", membership.organizationId)
    .is("returned_at", null)

  if (countError) {
    return {
      ok: false,
      error: translateDbError(countError, NO_EDIT_PERMISSION),
    }
  }

  const { data, error } = await supabase
    .from("keys")
    .update({ status: count ? "checked_out" : "available" })
    .eq("id", id.data)
    .eq("organization_id", membership.organizationId)
    .eq("status", "lost")
    .select("id")

  if (error) return { ok: false, error: translateDbError(error, NO_EDIT_PERMISSION) }
  if (data.length === 0) return { ok: false, error: NO_EDIT_PERMISSION }

  revalidateKeys()
  return {
    ok: true,
    message: count ? "Chave encontrada; continua retirada." : "Chave encontrada e disponível.",
  }
}

export type KeyHistoryItem = {
  id: string
  takerKind: KeyTakerKind
  takerLabel: string
  takenAt: string
  dueAt: string | null
  returnedAt: string | null
  isOverdue: boolean
  notes: string | null
  registeredBy: string | null
}

export type KeyHistoryResult =
  { ok: true; movements: KeyHistoryItem[] } | { ok: false; error: string }

export async function loadKeyHistory(keyId: string): Promise<KeyHistoryResult> {
  const id = keyIdSchema.safeParse(keyId)

  if (!id.success) return { ok: false, error: "Chave inválida." }

  const { membership } = await requireMembership()
  const supabase = await createClient()

  const { data, error } = await supabase
    .from("key_movements")
    .select(
      "id, taken_by_user, taken_by_client_id, taken_at, due_at, returned_at, notes, created_by, client:clients!key_movements_client_fkey(name)"
    )
    .eq("key_id", id.data)
    .eq("organization_id", membership.organizationId)
    .order("taken_at", { ascending: false })
    .limit(100)

  if (error) {
    return {
      ok: false,
      error: translateDbError(error, "Você não tem acesso ao histórico desta chave."),
    }
  }

  try {
    const names = await getProfileNames(
      supabase,
      data.flatMap((movement) =>
        [movement.taken_by_user, movement.created_by].filter((value): value is string => !!value)
      )
    )

    const now = Date.now()

    return {
      ok: true,
      movements: data.map((movement) => {
        const taker = describeTaker(movement, names)

        return {
          id: movement.id,
          takerKind: taker.kind,
          takerLabel: taker.label,
          takenAt: movement.taken_at,
          dueAt: movement.due_at,
          returnedAt: movement.returned_at,
          isOverdue:
            movement.returned_at === null &&
            movement.due_at !== null &&
            Date.parse(movement.due_at) < now,
          notes: movement.notes,
          registeredBy: movement.created_by ? (names.get(movement.created_by) ?? null) : null,
        }
      }),
    }
  } catch {
    return { ok: false, error: "Não foi possível carregar o histórico agora." }
  }
}

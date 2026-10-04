"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"

import type { ActionResult } from "@/lib/auth/action-result"
import { requireMembership } from "@/lib/auth/session"
import { CLIENTS_PATH } from "@/lib/clientes/constants"
import { permissionDeniedMessage, translateDatabaseError } from "@/lib/clientes/db-errors"
import {
  interestFormSchema,
  toInterestRow,
  type InterestFormValues,
} from "@/lib/clientes/interest-schema"
import { canDeleteClientData } from "@/lib/clientes/permissions"
import { createClient } from "@/lib/supabase/server"

const idSchema = z.guid()

/** Cria (interestId null) ou atualiza um perfil de busca do cliente. */
export async function saveClientInterest(
  clientId: string,
  interestId: string | null,
  values: InterestFormValues
): Promise<ActionResult> {
  if (
    !idSchema.safeParse(clientId).success ||
    (interestId && !idSchema.safeParse(interestId).success)
  ) {
    return { ok: false, error: "Perfil de busca inválido." }
  }

  const parsed = interestFormSchema.safeParse(values)

  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Confira os campos.",
    }
  }

  const { membership } = await requireMembership()
  const action = "editar o perfil de busca deste cliente"

  if (membership.role === "finance") {
    return { ok: false, error: permissionDeniedMessage(action) }
  }

  const supabase = await createClient()
  const row = toInterestRow(parsed.data)

  if (interestId) {
    const { data, error } = await supabase
      .from("client_interests")
      .update(row)
      .eq("id", interestId)
      .eq("client_id", clientId)
      .eq("organization_id", membership.organizationId)
      .select("id")

    if (error) {
      return { ok: false, error: translateDatabaseError(error, action) }
    }

    if (data.length === 0) {
      return { ok: false, error: permissionDeniedMessage(action) }
    }
  } else {
    const { error } = await supabase.from("client_interests").insert({
      ...row,
      organization_id: membership.organizationId,
      client_id: clientId,
    })

    if (error) {
      return { ok: false, error: translateDatabaseError(error, action) }
    }
  }

  revalidatePath(`${CLIENTS_PATH}/${clientId}`)

  return {
    ok: true,
    message: interestId ? "Perfil de busca atualizado." : "Perfil de busca criado.",
  }
}

export async function setClientInterestActive(
  interestId: string,
  clientId: string,
  active: boolean
): Promise<ActionResult> {
  if (!idSchema.safeParse(interestId).success || !idSchema.safeParse(clientId).success) {
    return { ok: false, error: "Perfil de busca inválido." }
  }

  const { membership } = await requireMembership()
  const action = "editar o perfil de busca deste cliente"

  if (membership.role === "finance") {
    return { ok: false, error: permissionDeniedMessage(action) }
  }

  const supabase = await createClient()
  const { data, error } = await supabase
    .from("client_interests")
    .update({ active: Boolean(active) })
    .eq("id", interestId)
    .eq("client_id", clientId)
    .eq("organization_id", membership.organizationId)
    .select("id")

  if (error) {
    return { ok: false, error: translateDatabaseError(error, action) }
  }

  if (data.length === 0) {
    return { ok: false, error: permissionDeniedMessage(action) }
  }

  revalidatePath(`${CLIENTS_PATH}/${clientId}`)

  return {
    ok: true,
    message: active ? "Perfil de busca ativado." : "Perfil de busca desativado.",
  }
}

export async function deleteClientInterest(
  interestId: string,
  clientId: string
): Promise<ActionResult> {
  if (!idSchema.safeParse(interestId).success || !idSchema.safeParse(clientId).success) {
    return { ok: false, error: "Perfil de busca inválido." }
  }

  const { membership } = await requireMembership()
  const action = "excluir perfis de busca"

  if (!canDeleteClientData(membership.role)) {
    return { ok: false, error: permissionDeniedMessage(action) }
  }

  const supabase = await createClient()
  const { data, error } = await supabase
    .from("client_interests")
    .delete()
    .eq("id", interestId)
    .eq("client_id", clientId)
    .eq("organization_id", membership.organizationId)
    .select("id")

  if (error) {
    return { ok: false, error: translateDatabaseError(error, action) }
  }

  if (data.length === 0) {
    return { ok: false, error: permissionDeniedMessage(action) }
  }

  revalidatePath(`${CLIENTS_PATH}/${clientId}`)

  return { ok: true, message: "Perfil de busca excluído." }
}

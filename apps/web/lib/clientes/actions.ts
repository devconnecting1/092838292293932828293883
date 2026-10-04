"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"

import type { ActionResult } from "@/lib/auth/action-result"
import { requireMembership } from "@/lib/auth/session"
import { lookupCep, type CepAddress } from "@/lib/br/cep"
import {
  INVALID_FIELDS_MESSAGE,
  toFieldErrors,
  type ActionResultWithData,
} from "@/lib/clientes/action-result"
import { CLIENTS_PATH } from "@/lib/clientes/constants"
import { permissionDeniedMessage, translateDatabaseError } from "@/lib/clientes/db-errors"
import { canCreateClients, canDeleteClientData } from "@/lib/clientes/permissions"
import { clientFormSchema, toClientRow, type ClientFormValues } from "@/lib/clientes/schemas"
import { moveToTrash } from "@/lib/lixeira/actions"
import { createClient } from "@/lib/supabase/server"

const idSchema = z.guid()

function duplicateDocumentFieldErrors(code: string | undefined, message: string) {
  return code === "23505" ? { document: message } : undefined
}

export async function createClientRecord(
  values: ClientFormValues
): Promise<ActionResultWithData<{ id: string }>> {
  const parsed = clientFormSchema.safeParse(values)

  if (!parsed.success) {
    return {
      ok: false,
      error: INVALID_FIELDS_MESSAGE,
      fieldErrors: toFieldErrors(parsed.error),
    }
  }

  const { user, membership } = await requireMembership()

  if (!canCreateClients(membership.role)) {
    return { ok: false, error: permissionDeniedMessage("cadastrar clientes") }
  }

  const row = toClientRow(parsed.data)

  // Corretor só enxerga clientes atribuídos a ele: o responsável é ele mesmo.
  if (membership.role === "broker") {
    row.assigned_to = user.id
  }

  const supabase = await createClient()
  const { data, error } = await supabase
    .from("clients")
    .insert({ ...row, organization_id: membership.organizationId })
    .select("id")
    .single()

  if (error) {
    const message = translateDatabaseError(error, "cadastrar clientes")
    return {
      ok: false,
      error: message,
      fieldErrors: duplicateDocumentFieldErrors(error.code, message),
    }
  }

  revalidatePath(CLIENTS_PATH)
  revalidatePath("/painel")

  return { ok: true, data: { id: data.id }, message: "Cliente cadastrado." }
}

export async function updateClientRecord(
  clientId: string,
  values: ClientFormValues
): Promise<ActionResultWithData<{ id: string }>> {
  if (!idSchema.safeParse(clientId).success) {
    return { ok: false, error: "Cliente inválido." }
  }

  const parsed = clientFormSchema.safeParse(values)

  if (!parsed.success) {
    return {
      ok: false,
      error: INVALID_FIELDS_MESSAGE,
      fieldErrors: toFieldErrors(parsed.error),
    }
  }

  const { membership } = await requireMembership()
  const action = "editar este cliente"

  if (membership.role === "finance") {
    return { ok: false, error: permissionDeniedMessage(action) }
  }

  const supabase = await createClient()
  const { data: existing, error: loadError } = await supabase
    .from("clients")
    .select("id, assigned_to, lgpd_consent_at")
    .eq("id", clientId)
    .eq("organization_id", membership.organizationId)
    .maybeSingle()

  if (loadError) {
    return { ok: false, error: translateDatabaseError(loadError, action) }
  }

  if (!existing) {
    return {
      ok: false,
      error: "Cliente não encontrado. Ele pode ter sido removido.",
    }
  }

  const row = toClientRow(parsed.data, {
    previousConsentAt: existing.lgpd_consent_at,
  })

  if (membership.role === "broker") {
    row.assigned_to = existing.assigned_to
  }

  const { data, error } = await supabase
    .from("clients")
    .update(row)
    .eq("id", clientId)
    .eq("organization_id", membership.organizationId)
    .select("id")

  if (error) {
    const message = translateDatabaseError(error, action)
    return {
      ok: false,
      error: message,
      fieldErrors: duplicateDocumentFieldErrors(error.code, message),
    }
  }

  if (data.length === 0) {
    return { ok: false, error: permissionDeniedMessage(action) }
  }

  revalidatePath(CLIENTS_PATH)
  revalidatePath(`${CLIENTS_PATH}/${clientId}`)

  return { ok: true, data: { id: clientId }, message: "Cliente atualizado." }
}

/**
 * Exclui o cliente (dono/gerente): vai para a lixeira por 30 dias. A exclusão
 * definitiva (com os arquivos do Storage) sai da lixeira ou da rotina diária,
 * que respeitam a guarda legal (ver lib/lixeira).
 */
export async function deleteClientRecord(clientId: string): Promise<ActionResult> {
  if (!idSchema.safeParse(clientId).success) {
    return { ok: false, error: "Cliente inválido." }
  }

  const { membership } = await requireMembership()

  if (!canDeleteClientData(membership.role)) {
    return { ok: false, error: permissionDeniedMessage("excluir clientes") }
  }

  return moveToTrash("client", clientId)
}

/** Consulta o CEP no servidor (ViaCEP/BrasilAPI). */
export async function lookupClientAddress(
  postalCode: string
): Promise<ActionResultWithData<CepAddress>> {
  await requireMembership()

  const digits = typeof postalCode === "string" ? postalCode.replace(/\D/g, "") : ""

  if (digits.length !== 8) {
    return { ok: false, error: "CEP inválido. Use o formato 00000-000." }
  }

  const address = await lookupCep(digits)

  if (!address) {
    return {
      ok: false,
      error: "CEP não encontrado. Preencha o endereço manualmente.",
    }
  }

  return { ok: true, data: address }
}

/** Registra a abertura da ficha (LGPD: quem viu o quê). Falhas não bloqueiam a tela. */
export async function logClientView(clientId: string): Promise<void> {
  if (!idSchema.safeParse(clientId).success) {
    return
  }

  await requireMembership()

  const supabase = await createClient()
  const { error } = await supabase.rpc("log_access_event", {
    p_entity: "clients",
    p_entity_id: clientId,
    p_action: "view",
  })

  if (error) {
    console.error("[clientes] falha ao registrar acesso à ficha:", error.code ?? "erro")
  }
}

"use server"

import { revalidatePath } from "next/cache"
import type { z } from "zod"

import type { ActionResult } from "@/lib/auth/action-result"
import { requireMembership } from "@/lib/auth/session"
import {
  condominiumFormSchema,
  toCondominiumPayload,
  type CondominiumFormValues,
} from "@/lib/condominios/schema"
import { translateDbError, type DbErrorLike } from "@/lib/imoveis/db-errors"
import { isUuid } from "@/lib/imoveis/ids"
import {
  canCreateCondominium,
  canDeleteCondominium,
  canEditCondominium,
} from "@/lib/imoveis/permissions"
import { createClient } from "@/lib/supabase/server"

export type CondominiumField = keyof CondominiumFormValues
export type CondominiumFieldErrors = Partial<Record<CondominiumField, string>>

export type SaveCondominiumResult =
  | { ok: true; id: string; message: string }
  | { ok: false; error: string; fieldErrors?: CondominiumFieldErrors }

const INVALID_FIELDS_MESSAGE = "Confira os campos destacados."
const INVALID_ID_MESSAGE = "Condomínio inválido. Recarregue a página e tente de novo."
const NOT_FOUND_MESSAGE = "Condomínio não encontrado nesta imobiliária. Ele pode ter sido excluído."

const FORM_FIELDS: ReadonlySet<string> = new Set(Object.keys(condominiumFormSchema.shape))

/** CHECKs de public.condominiums → campo do formulário. */
const FIELD_BY_CONSTRAINT: Record<string, CondominiumField> = {
  condominiums_name_check: "name",
  condominiums_postal_code_format: "postalCode",
  condominiums_street_check: "street",
  condominiums_street_number_check: "streetNumber",
  condominiums_complement_check: "complement",
  condominiums_neighborhood_check: "neighborhood",
  condominiums_city_check: "city",
  condominiums_state_format: "state",
  condominiums_avg_condo_fee_check: "avgCondoFee",
  condominiums_notes_check: "notes",
}

function toFieldErrors(error: z.ZodError): CondominiumFieldErrors {
  const fieldErrors: CondominiumFieldErrors = {}

  for (const issue of error.issues) {
    const field = issue.path[0]
    if (typeof field !== "string" || !FORM_FIELDS.has(field)) continue

    const key = field as CondominiumField
    if (!fieldErrors[key]) fieldErrors[key] = issue.message
  }

  return fieldErrors
}

function toDbFailure(error: DbErrorLike, action: string): SaveCondominiumResult {
  const message = translateDbError(error, action)
  const constraint = /constraint "([^"]+)"/.exec(
    `${error.message ?? ""} ${error.details ?? ""}`
  )?.[1]
  const field = constraint ? FIELD_BY_CONSTRAINT[constraint] : undefined

  if (!field) {
    return { ok: false, error: message }
  }

  const fieldErrors: CondominiumFieldErrors = {}
  fieldErrors[field] = message
  return { ok: false, error: message, fieldErrors }
}

function revalidateCondominiumPaths(condominiumId: string) {
  revalidatePath("/condominios")
  revalidatePath(`/condominios/${condominiumId}`)
  // Formulário (novo/editar) e ficha dos imóveis listam ou exibem condomínios.
  revalidatePath("/imoveis", "layout")
}

/**
 * Cadastra (sem `id`) ou atualiza (com `id`) um condomínio da imobiliária
 * atual. As checagens de papel só melhoram a mensagem: o RLS é a garantia.
 */
export async function saveCondominiumAction(
  values: CondominiumFormValues,
  id?: string
): Promise<SaveCondominiumResult> {
  const condominiumId = typeof id === "string" ? id : null

  if (condominiumId !== null && !isUuid(condominiumId)) {
    return { ok: false, error: INVALID_ID_MESSAGE }
  }

  const parsed = condominiumFormSchema.safeParse(values)

  if (!parsed.success) {
    return {
      ok: false,
      error: INVALID_FIELDS_MESSAGE,
      fieldErrors: toFieldErrors(parsed.error),
    }
  }

  const { user, membership } = await requireMembership()
  const organizationId = membership.organizationId
  const supabase = await createClient()
  const payload = toCondominiumPayload(parsed.data)

  if (condominiumId === null) {
    if (!canCreateCondominium(membership.role)) {
      return {
        ok: false,
        error: "Seu papel nesta imobiliária não permite cadastrar condomínios.",
      }
    }

    const { data, error } = await supabase
      .from("condominiums")
      .insert({ ...payload, organization_id: organizationId })
      .select("id")
      .single()

    if (error) {
      return toDbFailure(error, "cadastrar o condomínio")
    }

    revalidateCondominiumPaths(data.id)
    return { ok: true, id: data.id, message: "Condomínio cadastrado." }
  }

  const { data: current, error: currentError } = await supabase
    .from("condominiums")
    .select("id, created_by")
    .eq("organization_id", organizationId)
    .eq("id", condominiumId)
    .maybeSingle()

  if (currentError) {
    return toDbFailure(currentError, "salvar o condomínio")
  }

  if (!current) {
    return { ok: false, error: NOT_FOUND_MESSAGE }
  }

  if (!canEditCondominium(membership.role, user.id, current.created_by)) {
    return {
      ok: false,
      error:
        "Você não tem permissão para editar este condomínio. Só a gestão ou quem o cadastrou pode alterá-lo.",
    }
  }

  const { data, error } = await supabase
    .from("condominiums")
    .update(payload)
    .eq("organization_id", organizationId)
    .eq("id", condominiumId)
    .select("id")

  if (error) {
    return toDbFailure(error, "salvar o condomínio")
  }

  // UPDATE bloqueado pelo RLS não gera erro: só não afeta nenhuma linha.
  if (!data || data.length === 0) {
    return {
      ok: false,
      error:
        "O condomínio não foi alterado: você não tem permissão para editá-lo ou ele foi excluído.",
    }
  }

  revalidateCondominiumPaths(condominiumId)
  return { ok: true, id: condominiumId, message: "Condomínio atualizado." }
}

/** Exclui o condomínio; os imóveis vinculados ficam sem condomínio (ON DELETE SET NULL). */
export async function deleteCondominiumAction(id: string): Promise<ActionResult> {
  if (!isUuid(id)) {
    return { ok: false, error: INVALID_ID_MESSAGE }
  }

  const { membership } = await requireMembership()

  if (!canDeleteCondominium(membership.role)) {
    return {
      ok: false,
      error: "Somente o dono e o gerente da imobiliária podem excluir condomínios.",
    }
  }

  const supabase = await createClient()
  const { data, error } = await supabase
    .from("condominiums")
    .delete()
    .eq("organization_id", membership.organizationId)
    .eq("id", id)
    .select("id")

  if (error) {
    return { ok: false, error: translateDbError(error, "excluir o condomínio") }
  }

  // DELETE bloqueado pelo RLS não gera erro: só não afeta nenhuma linha.
  if (!data || data.length === 0) {
    return {
      ok: false,
      error:
        "O condomínio não foi excluído: ele não existe mais ou você não tem permissão para removê-lo.",
    }
  }

  revalidateCondominiumPaths(id)
  return { ok: true, message: "Condomínio excluído." }
}

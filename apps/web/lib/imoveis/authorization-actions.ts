"use server"

import { dateInputToTimestamp, timestampToDateInput } from "@/components/imoveis/detail/format"
import {
  authorizationFormSchema,
  parsePercentInput,
  type AuthorizationFormValues,
} from "@/components/imoveis/detail/schemas"
import type { ActionResult } from "@/lib/auth/action-result"
import { translateDbError } from "@/lib/imoveis/db-errors"
import { isUuid } from "@/lib/imoveis/ids"
import {
  REMOVE_AUTHORIZATION_DENIED_MESSAGE,
  canDeletePropertyRecords,
} from "@/lib/imoveis/permissions"
import {
  getPropertyActionContext,
  refreshImobScore,
  revalidatePropertyPaths,
} from "@/lib/imoveis/server-context"

/**
 * Cria (authorizationId null) ou edita uma autorização de venda/locação.
 * O proprietário precisa estar cadastrado em property_owners deste imóvel.
 * A autorização vigente vale pontos na Nota do Anúncio, recalculada aqui.
 */
export async function saveAuthorizationAction(
  propertyId: string,
  authorizationId: string | null,
  values: AuthorizationFormValues
): Promise<ActionResult> {
  if (!isUuid(propertyId) || (authorizationId !== null && !isUuid(authorizationId))) {
    return { ok: false, error: "Autorização inválida." }
  }

  const parsed = authorizationFormSchema.safeParse(values)
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Confira os dados da autorização.",
    }
  }

  const loaded = await getPropertyActionContext(propertyId)
  if (!loaded.ok) return loaded

  const { supabase, organizationId, property } = loaded.context
  const data = parsed.data

  let existing: {
    id: string
    owner_client_id: string
    signed_at: string | null
  } | null = null

  if (authorizationId) {
    const { data: row, error } = await supabase
      .from("listing_authorizations")
      .select("id, owner_client_id, signed_at")
      .eq("organization_id", organizationId)
      .eq("property_id", property.id)
      .eq("id", authorizationId)
      .maybeSingle()

    if (error) {
      return {
        ok: false,
        error: translateDbError(error, "editar a autorização"),
      }
    }
    if (!row) {
      return {
        ok: false,
        error: "Autorização não encontrada. Ela pode ter sido removida.",
      }
    }
    existing = row
  }

  // Manter o proprietário de uma autorização antiga é permitido mesmo que ele
  // não esteja mais na lista de proprietários; trocar exige um proprietário atual.
  if (!existing || existing.owner_client_id !== data.ownerClientId) {
    const { data: owner, error: ownerError } = await supabase
      .from("property_owners")
      .select("id")
      .eq("organization_id", organizationId)
      .eq("property_id", property.id)
      .eq("client_id", data.ownerClientId)
      .maybeSingle()

    if (ownerError) {
      return {
        ok: false,
        error: translateDbError(ownerError, "salvar a autorização"),
      }
    }
    if (!owner) {
      return {
        ok: false,
        error: "Selecione um dos proprietários cadastrados na aba Proprietários.",
      }
    }
  }

  // Mesma data de assinatura: preserva o horário original gravado.
  const signedAt =
    existing?.signed_at && timestampToDateInput(existing.signed_at) === data.signedOn
      ? existing.signed_at
      : dateInputToTimestamp(data.signedOn)

  const columns = {
    owner_client_id: data.ownerClientId,
    exclusive: data.exclusive,
    starts_on: data.startsOn,
    ends_on: data.endsOn || null,
    commission_percent: parsePercentInput(data.commissionPercent),
    signed_at: signedAt,
  }

  if (existing) {
    const { data: rows, error } = await supabase
      .from("listing_authorizations")
      .update(columns)
      .eq("organization_id", organizationId)
      .eq("property_id", property.id)
      .eq("id", existing.id)
      .select("id")

    if (error) {
      return {
        ok: false,
        error: translateDbError(error, "editar a autorização"),
      }
    }
    if (!rows?.length) {
      return {
        ok: false,
        error: "Você não tem permissão para editar esta autorização.",
      }
    }
  } else {
    const { data: rows, error } = await supabase
      .from("listing_authorizations")
      .insert({
        ...columns,
        organization_id: organizationId,
        property_id: property.id,
      })
      .select("id")

    if (error) {
      return {
        ok: false,
        error: translateDbError(error, "cadastrar a autorização"),
      }
    }
    if (!rows?.length) {
      return {
        ok: false,
        error: "Você não tem permissão para cadastrar autorizações neste imóvel.",
      }
    }
  }

  await refreshImobScore(supabase, organizationId, property.id)
  revalidatePropertyPaths(property.id)

  return {
    ok: true,
    message: existing ? "Autorização atualizada." : "Autorização cadastrada.",
  }
}

export async function removeAuthorizationAction(
  propertyId: string,
  authorizationId: string
): Promise<ActionResult> {
  if (!isUuid(propertyId) || !isUuid(authorizationId)) {
    return { ok: false, error: "Autorização inválida." }
  }

  const loaded = await getPropertyActionContext(propertyId, {
    requireEdit: false,
  })
  if (!loaded.ok) return loaded

  const { supabase, organizationId, role, property } = loaded.context

  if (!canDeletePropertyRecords(role)) {
    return {
      ok: false,
      error: REMOVE_AUTHORIZATION_DENIED_MESSAGE,
    }
  }

  const { data, error } = await supabase
    .from("listing_authorizations")
    .delete()
    .eq("organization_id", organizationId)
    .eq("property_id", property.id)
    .eq("id", authorizationId)
    .select("id")

  if (error) {
    return {
      ok: false,
      error: translateDbError(error, "remover a autorização"),
    }
  }
  if (!data?.length) {
    return {
      ok: false,
      error: "Você não tem permissão para remover esta autorização ou ela já foi removida.",
    }
  }

  await refreshImobScore(supabase, organizationId, property.id)
  revalidatePropertyPaths(property.id)

  return { ok: true, message: "Autorização removida." }
}

"use server"

import { revalidatePath } from "next/cache"

import {
  addOwnerInputSchema,
  ownerShareFormSchema,
  parsePercentInput,
  type AddOwnerInput,
} from "@/components/imoveis/detail/schemas"
import type { OwnerClientOption } from "@/components/imoveis/detail/types"
import type { ActionResult } from "@/lib/auth/action-result"
import { searchClientOptions } from "@/lib/clientes/search-actions"
import { translateDbError } from "@/lib/imoveis/db-errors"
import { isUuid } from "@/lib/imoveis/ids"
import { REMOVE_OWNER_DENIED_MESSAGE, canDeletePropertyRecords } from "@/lib/imoveis/permissions"
import { getPropertyActionContext, revalidatePropertyPaths } from "@/lib/imoveis/server-context"

function revalidateOwnerPaths(propertyId: string, clientId: string | null) {
  revalidatePropertyPaths(propertyId)
  if (clientId) revalidatePath(`/clientes/${clientId}`)
}

/**
 * Busca de clientes para o combobox de proprietários: a mesma busca sem acento
 * dos outros combobox de cliente (RPC `search_clients`). O RLS limita ao que o
 * papel enxerga (corretor: os seus, os compartilhados e os proprietários dos
 * imóveis em que é corretor ou captador; captador: os que criou e os
 * proprietários dos imóveis em que é captador ou corretor).
 */
export async function searchClientsForOwnerAction(query: string): Promise<OwnerClientOption[]> {
  const options = await searchClientOptions(query)

  return options.map((option) => ({ ...option, description: option.description ?? "" }))
}

export async function addPropertyOwnerAction(
  propertyId: string,
  input: AddOwnerInput
): Promise<ActionResult> {
  if (!isUuid(propertyId)) {
    return { ok: false, error: "Imóvel inválido." }
  }

  const parsed = addOwnerInputSchema.safeParse(input)
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Confira os dados do proprietário.",
    }
  }

  const loaded = await getPropertyActionContext(propertyId)
  if (!loaded.ok) return loaded

  const { supabase, organizationId, property } = loaded.context
  const { clientId, sharePercent } = parsed.data

  // O FK aceitaria qualquer cliente da imobiliária; exigimos que o papel o enxergue.
  const { data: client, error: clientError } = await supabase
    .from("clients")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("id", clientId)
    .maybeSingle()

  if (clientError) {
    return {
      ok: false,
      error: translateDbError(clientError, "adicionar o proprietário"),
    }
  }
  if (!client) {
    return {
      ok: false,
      error: "Cliente não encontrado ou fora do seu acesso nesta imobiliária.",
    }
  }

  const { data, error } = await supabase
    .from("property_owners")
    .insert({
      organization_id: organizationId,
      property_id: property.id,
      client_id: clientId,
      share_percent: parsePercentInput(sharePercent),
    })
    .select("id")

  if (error) {
    return {
      ok: false,
      error: translateDbError(error, "adicionar o proprietário"),
    }
  }
  if (!data?.length) {
    return {
      ok: false,
      error: "Você não tem permissão para adicionar proprietários a este imóvel.",
    }
  }

  revalidateOwnerPaths(property.id, clientId)

  return { ok: true, message: "Proprietário adicionado." }
}

export async function updatePropertyOwnerShareAction(
  propertyId: string,
  ownerId: string,
  sharePercent: string
): Promise<ActionResult> {
  if (!isUuid(propertyId) || !isUuid(ownerId)) {
    return { ok: false, error: "Proprietário inválido." }
  }

  const parsed = ownerShareFormSchema.safeParse({ sharePercent })
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Participação inválida.",
    }
  }

  const loaded = await getPropertyActionContext(propertyId)
  if (!loaded.ok) return loaded

  const { supabase, organizationId, property } = loaded.context

  const { data, error } = await supabase
    .from("property_owners")
    .update({ share_percent: parsePercentInput(parsed.data.sharePercent) })
    .eq("organization_id", organizationId)
    .eq("property_id", property.id)
    .eq("id", ownerId)
    .select("id, client_id")

  if (error) {
    return {
      ok: false,
      error: translateDbError(error, "alterar a participação"),
    }
  }

  const row = data?.[0]
  if (!row) {
    return {
      ok: false,
      error: "Você não tem permissão para alterar este proprietário ou ele foi removido.",
    }
  }

  revalidateOwnerPaths(property.id, row.client_id)

  return { ok: true, message: "Participação atualizada." }
}

export async function removePropertyOwnerAction(
  propertyId: string,
  ownerId: string
): Promise<ActionResult> {
  if (!isUuid(propertyId) || !isUuid(ownerId)) {
    return { ok: false, error: "Proprietário inválido." }
  }

  const loaded = await getPropertyActionContext(propertyId, {
    requireEdit: false,
  })
  if (!loaded.ok) return loaded

  const { supabase, organizationId, role, property } = loaded.context

  if (!canDeletePropertyRecords(role)) {
    return {
      ok: false,
      error: REMOVE_OWNER_DENIED_MESSAGE,
    }
  }

  const { data, error } = await supabase
    .from("property_owners")
    .delete()
    .eq("organization_id", organizationId)
    .eq("property_id", property.id)
    .eq("id", ownerId)
    .select("id, client_id")

  if (error) {
    return {
      ok: false,
      error: translateDbError(error, "remover o proprietário"),
    }
  }

  const row = data?.[0]
  if (!row) {
    return {
      ok: false,
      error: "Você não tem permissão para remover este proprietário ou ele já foi removido.",
    }
  }

  revalidateOwnerPaths(property.id, row.client_id)

  return { ok: true, message: "Proprietário removido." }
}

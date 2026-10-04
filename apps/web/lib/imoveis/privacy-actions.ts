"use server"

import type { ActionResult } from "@/lib/auth/action-result"
import { translateDbError } from "@/lib/imoveis/db-errors"
import { isUuid } from "@/lib/imoveis/ids"
import { canManageProperty, MANAGE_PROPERTY_DENIED_MESSAGE } from "@/lib/imoveis/permissions"
import { getPropertyActionContext, revalidatePropertyPaths } from "@/lib/imoveis/server-context"

/**
 * Sigilo do imóvel (properties.is_restricted e property_shares). Quem decide:
 * dono, gerente, captador e corretor responsável. O banco confere de novo
 * (gatilho properties_guard_restricted e RLS de property_shares).
 */

export async function setPropertyRestrictedAction(
  propertyId: string,
  restricted: boolean
): Promise<ActionResult> {
  if (!isUuid(propertyId) || typeof restricted !== "boolean") {
    return { ok: false, error: "Imóvel inválido." }
  }

  const loaded = await getPropertyActionContext(propertyId, { requireEdit: false })
  if (!loaded.ok) return loaded

  const { supabase, organizationId, userId, role, property } = loaded.context

  if (!canManageProperty(role, userId, property)) {
    return { ok: false, error: MANAGE_PROPERTY_DENIED_MESSAGE }
  }

  if (property.is_restricted === restricted) {
    return {
      ok: true,
      message: restricted ? "O imóvel já estava restrito." : "O imóvel já estava visível à equipe.",
    }
  }

  const { data, error } = await supabase
    .from("properties")
    .update(
      restricted ? { is_restricted: true, published_to_portals: false } : { is_restricted: false }
    )
    .eq("organization_id", organizationId)
    .eq("id", property.id)
    .select("id")

  if (error) {
    return { ok: false, error: translateDbError(error, "mudar o sigilo deste imóvel") }
  }
  if (!data?.length) {
    return { ok: false, error: MANAGE_PROPERTY_DENIED_MESSAGE }
  }

  revalidatePropertyPaths(property.id)

  return {
    ok: true,
    message: restricted
      ? "Imóvel restrito: só quem tem acesso vê. Ele saiu dos portais e da página pública."
      : "Sigilo retirado: a equipe volta a ver o imóvel.",
  }
}

export async function sharePropertyAction(
  propertyId: string,
  memberId: string
): Promise<ActionResult> {
  if (!isUuid(propertyId) || !isUuid(memberId)) {
    return { ok: false, error: "Pessoa inválida." }
  }

  const loaded = await getPropertyActionContext(propertyId, { requireEdit: false })
  if (!loaded.ok) return loaded

  const { supabase, organizationId, userId, role, property } = loaded.context

  if (!canManageProperty(role, userId, property)) {
    return { ok: false, error: MANAGE_PROPERTY_DENIED_MESSAGE }
  }

  const { error } = await supabase.from("property_shares").insert({
    organization_id: organizationId,
    property_id: property.id,
    user_id: memberId,
  })

  if (error) {
    return { ok: false, error: translateDbError(error, "compartilhar este imóvel") }
  }

  revalidatePropertyPaths(property.id)

  return { ok: true, message: "Acesso liberado." }
}

export async function unsharePropertyAction(
  propertyId: string,
  memberId: string
): Promise<ActionResult> {
  if (!isUuid(propertyId) || !isUuid(memberId)) {
    return { ok: false, error: "Pessoa inválida." }
  }

  const loaded = await getPropertyActionContext(propertyId, { requireEdit: false })
  if (!loaded.ok) return loaded

  const { supabase, organizationId, userId, role, property } = loaded.context

  if (!canManageProperty(role, userId, property)) {
    return { ok: false, error: MANAGE_PROPERTY_DENIED_MESSAGE }
  }

  const { data, error } = await supabase
    .from("property_shares")
    .delete()
    .eq("organization_id", organizationId)
    .eq("property_id", property.id)
    .eq("user_id", memberId)
    .select("user_id")

  if (error) {
    return { ok: false, error: translateDbError(error, "remover o acesso a este imóvel") }
  }
  if (!data?.length) {
    return { ok: false, error: "Esta pessoa já não tinha acesso escolhido ao imóvel." }
  }

  revalidatePropertyPaths(property.id)

  return { ok: true, message: "Acesso removido." }
}

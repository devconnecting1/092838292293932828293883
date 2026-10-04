import "server-only"

import { revalidatePath } from "next/cache"

import type { Tables } from "@workspace/database/types"

import type { Role } from "@/lib/auth/roles"
import { requireMembership } from "@/lib/auth/session"
import { canEditProperty } from "@/lib/imoveis/permissions"
import { computePropertyScore, summarizeMedia } from "@/lib/imoveis/mappers"
import {
  getAuthorizationPeriods,
  getPropertyMediaRows,
  getPropertyRow,
  type ServerSupabaseClient,
} from "@/lib/imoveis/queries"
import { createClient } from "@/lib/supabase/server"

export type PropertyActionContext = {
  supabase: ServerSupabaseClient
  organizationId: string
  userId: string
  role: Role
  property: Tables<"properties">
}

/**
 * Contexto comum das Server Actions de um imóvel: sessão, imobiliária atual,
 * imóvel da imobiliária e (opcional) permissão de edição. O RLS continua
 * sendo a garantia; a checagem aqui só dá uma mensagem melhor.
 */
export async function getPropertyActionContext(
  propertyId: string,
  { requireEdit = true }: { requireEdit?: boolean } = {}
): Promise<{ ok: true; context: PropertyActionContext } | { ok: false; error: string }> {
  const { user, membership } = await requireMembership()
  const supabase = await createClient()

  let property: Tables<"properties"> | null
  try {
    property = await getPropertyRow(supabase, membership.organizationId, propertyId)
  } catch {
    return {
      ok: false,
      error: "Não foi possível carregar o imóvel agora. Tente novamente.",
    }
  }

  if (!property) {
    return { ok: false, error: "Imóvel não encontrado nesta imobiliária." }
  }

  if (requireEdit && !canEditProperty(membership.role, user.id, property)) {
    return {
      ok: false,
      error: "Você não tem permissão para editar este imóvel.",
    }
  }

  return {
    ok: true,
    context: {
      supabase,
      organizationId: membership.organizationId,
      userId: user.id,
      role: membership.role,
      property,
    },
  }
}

/**
 * Recalcula a Nota do Anúncio (imob_score) com os dados atuais (imóvel, fotos, vídeo/tour e
 * autorização) e grava em properties.imob_score se mudou.
 */
export async function refreshImobScore(
  supabase: ServerSupabaseClient,
  organizationId: string,
  propertyId: string
): Promise<number | null> {
  try {
    const [property, media, authorizations] = await Promise.all([
      getPropertyRow(supabase, organizationId, propertyId),
      getPropertyMediaRows(supabase, organizationId, propertyId),
      getAuthorizationPeriods(supabase, organizationId, propertyId),
    ])

    if (!property) return null

    const { score } = computePropertyScore(property, summarizeMedia(media), authorizations)

    if (property.imob_score !== score) {
      const { error } = await supabase
        .from("properties")
        .update({ imob_score: score })
        .eq("organization_id", organizationId)
        .eq("id", propertyId)

      if (error) return property.imob_score
    }

    return score
  } catch {
    return null
  }
}

/** Revalida as telas que mostram o imóvel. */
export function revalidatePropertyPaths(propertyId?: string) {
  revalidatePath("/imoveis")
  revalidatePath("/painel")

  if (propertyId) {
    revalidatePath(`/imoveis/${propertyId}`)
    revalidatePath(`/imoveis/${propertyId}/editar`)
  }
}

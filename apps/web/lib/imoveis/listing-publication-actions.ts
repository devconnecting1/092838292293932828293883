"use server"

import { revalidatePath } from "next/cache"

import {
  normalizeGoogleTagId,
  normalizeMetaPixelId,
} from "@workspace/core/properties/listing-publication"

import type { ActionResult } from "@/lib/auth/action-result"
import { TEAM_MANAGER_ROLES } from "@/lib/auth/roles"
import { INVALID_FIELDS_MESSAGE } from "@/lib/clientes/action-result"
import { getActionMembership, type FormActionResult } from "@/lib/configuracoes/action-context"
import { PERMISSION_DENIED_MESSAGE, translateDatabaseError } from "@/lib/configuracoes/errors"
import { getFieldErrors } from "@/lib/configuracoes/schemas"
import { translateDbError } from "@/lib/imoveis/db-errors"
import { isUuid } from "@/lib/imoveis/ids"
import {
  listingPublicationSettingsSchema,
  type ListingPublicationSettingsValues,
} from "@/lib/imoveis/listing-publication-schema"
import { getPropertyActionContext, revalidatePropertyPaths } from "@/lib/imoveis/server-context"
import { createClient } from "@/lib/supabase/server"

/**
 * Liga ou desliga a página pública de um imóvel. Quem edita o imóvel decide
 * (o RLS de properties confirma). Imóvel restrito nunca tem página, com a
 * chave ligada ou não; a página em cache some em até 1 minuto (ISR).
 */
export async function setPublicPageEnabledAction(
  propertyId: string,
  enabled: boolean
): Promise<ActionResult> {
  if (!isUuid(propertyId) || typeof enabled !== "boolean") {
    return { ok: false, error: "Imóvel inválido." }
  }

  const loaded = await getPropertyActionContext(propertyId)
  if (!loaded.ok) return loaded

  const { supabase, organizationId, property } = loaded.context

  if (enabled && property.is_restricted) {
    return {
      ok: false,
      error: "Imóvel restrito não tem página pública. Tire o sigilo antes de ligar.",
    }
  }

  const { data, error } = await supabase
    .from("properties")
    .update({ public_page_enabled: enabled })
    .eq("organization_id", organizationId)
    .eq("id", property.id)
    .select("id")

  if (error) {
    return { ok: false, error: translateDbError(error, "alterar a página pública deste imóvel") }
  }

  if (!data?.length) {
    return { ok: false, error: "Você não tem permissão para alterar este imóvel." }
  }

  revalidatePropertyPaths(property.id)

  return {
    ok: true,
    message: enabled
      ? "Página pública ligada."
      : "Página pública desligada. Ela sai do ar e do Google em até 1 minuto.",
  }
}

/** Regras de publicação da imobiliária: só dono e gerente. */
export async function saveListingPublicationSettingsAction(
  values: ListingPublicationSettingsValues
): Promise<FormActionResult<keyof ListingPublicationSettingsValues>> {
  const parsed = listingPublicationSettingsSchema.safeParse(values)

  if (!parsed.success) {
    return {
      ok: false,
      error: INVALID_FIELDS_MESSAGE,
      fieldErrors: getFieldErrors<keyof ListingPublicationSettingsValues>(parsed.error),
    }
  }

  const auth = await getActionMembership(TEAM_MANAGER_ROLES)

  if (!auth.ok) {
    return auth
  }

  const organizationId = auth.context.membership.organizationId
  const data = parsed.data
  const columns = {
    hide_without_valid_authorization: data.hideWithoutValidAuthorization,
    public_pages_enabled_by_default: data.publicPagesEnabledByDefault,
    meta_pixel_id: normalizeMetaPixelId(data.metaPixelId) ?? null,
    google_tag_id: normalizeGoogleTagId(data.googleTagId) ?? null,
  }
  const supabase = await createClient()

  // UPDATE quando já existe (a coluna organization_id não tem grant de UPDATE).
  const { data: existing, error: readError } = await supabase
    .from("listing_publication_settings")
    .select("organization_id")
    .eq("organization_id", organizationId)
    .maybeSingle()

  if (readError) {
    return { ok: false, error: translateDatabaseError(readError) }
  }

  const { data: saved, error } = existing
    ? await supabase
        .from("listing_publication_settings")
        .update(columns)
        .eq("organization_id", organizationId)
        .select("organization_id")
    : await supabase
        .from("listing_publication_settings")
        .insert({ organization_id: organizationId, ...columns })
        .select("organization_id")

  if (error) {
    return { ok: false, error: translateDatabaseError(error) }
  }

  if (!saved?.length) {
    return { ok: false, error: PERMISSION_DENIED_MESSAGE }
  }

  revalidatePath("/imoveis", "layout")
  revalidatePath("/configuracoes/imobiliaria")

  return {
    ok: true,
    message:
      "Regras de publicação salvas. As páginas públicas e o sitemap refletem a mudança em até 1 minuto; os portais, na próxima leitura do arquivo.",
  }
}

import "server-only"

import {
  DEFAULT_LISTING_PUBLICATION_SETTINGS,
  type ListingPublicationSettings,
} from "@workspace/core/properties/listing-publication"

import type { ServerSupabaseClient } from "@/lib/imoveis/queries"

/**
 * Regras de publicação da imobiliária (public.listing_publication_settings).
 * Sem linha, valem os padrões (tirar do ar autorização vencida e página pública
 * ligada). Falha de leitura também devolve os padrões: é o mesmo que o banco
 * aplica nas funções públicas quando a imobiliária nunca salvou nada.
 */
export async function getListingPublicationSettings(
  supabase: ServerSupabaseClient,
  organizationId: string
): Promise<ListingPublicationSettings> {
  const { data, error } = await supabase
    .from("listing_publication_settings")
    .select(
      "hide_without_valid_authorization, public_pages_enabled_by_default, meta_pixel_id, google_tag_id"
    )
    .eq("organization_id", organizationId)
    .maybeSingle()

  if (error) {
    console.error(`[imoveis/publicacao] leitura das regras falhou (${error.code ?? "erro"})`)
    return DEFAULT_LISTING_PUBLICATION_SETTINGS
  }

  if (!data) {
    return DEFAULT_LISTING_PUBLICATION_SETTINGS
  }

  return {
    hideWithoutValidAuthorization: data.hide_without_valid_authorization,
    publicPagesEnabledByDefault: data.public_pages_enabled_by_default,
    metaPixelId: data.meta_pixel_id,
    googleTagId: data.google_tag_id,
  }
}

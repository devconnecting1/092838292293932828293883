import "server-only"

import { cache } from "react"

import { isValidTenantSlug } from "@workspace/core/tenant/slug"

import { parsePublicPropertyPayload, type PublicPropertyPayload } from "@/lib/imovel-publico/types"
import { normalizePublicPropertyCode } from "@/lib/imovel-publico/urls"
import { createLandingAnonClient } from "@/lib/leads-publicos/supabase"

/** Slug da imobiliária vindo da URL: minúsculo e válido como subdomínio; senão null. */
export function normalizePublicOrgSlug(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null

  let decoded: string

  try {
    decoded = decodeURIComponent(value)
  } catch {
    return null
  }

  const slug = decoded.trim().toLowerCase()
  return isValidTenantSlug(slug) ? slug : null
}

/**
 * Imóvel ATIVO pela dupla slug + código; null se não existir, não estiver
 * ativo ou vier incompleto (a página responde 404 sem distinguir o motivo).
 * Memoizada por renderização: page e generateMetadata fazem uma chamada só.
 */
export const getPublicProperty = cache(
  async (rawOrgSlug: string, rawCode: string): Promise<PublicPropertyPayload | null> => {
    const orgSlug = normalizePublicOrgSlug(rawOrgSlug)
    const code = normalizePublicPropertyCode(rawCode)

    if (!orgSlug || !code) {
      return null
    }

    const supabase = createLandingAnonClient()
    const { data, error } = await supabase.rpc("get_public_property", {
      p_org_slug: orgSlug,
      p_code: code,
    })

    if (error) {
      throw new Error(`Não foi possível carregar o imóvel (${error.code || "erro"}).`)
    }

    return parsePublicPropertyPayload(data, orgSlug)
  }
)

export type PublicSitemap = {
  properties: { code: string; updatedAt: string | null }[]
  landingPages: { slug: string; updatedAt: string | null }[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function readUpdatedAt(value: unknown) {
  return typeof value === "string" && !Number.isNaN(new Date(value).getTime()) ? value : null
}

const LANDING_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/**
 * Imóveis ativos e landing pages publicadas da imobiliária, para o sitemap do
 * subdomínio. Imobiliária inexistente (ou falha do banco) devolve listas vazias.
 */
export async function getPublicSitemap(rawOrgSlug: string): Promise<PublicSitemap> {
  const empty: PublicSitemap = { properties: [], landingPages: [] }
  const orgSlug = normalizePublicOrgSlug(rawOrgSlug)

  if (!orgSlug) {
    return empty
  }

  try {
    const supabase = createLandingAnonClient()
    const { data, error } = await supabase.rpc("get_public_sitemap", { p_org_slug: orgSlug })

    if (error || !isRecord(data)) {
      if (error) {
        console.error(`[sitemap] get_public_sitemap falhou (${error.code || "erro"})`)
      }
      return empty
    }

    const properties = Array.isArray(data.properties) ? data.properties : []
    const landingPages = Array.isArray(data.landing_pages) ? data.landing_pages : []

    return {
      properties: properties.flatMap((item) => {
        const code = isRecord(item) ? normalizePublicPropertyCode(String(item.code ?? "")) : null
        return code && isRecord(item) ? [{ code, updatedAt: readUpdatedAt(item.updated_at) }] : []
      }),
      landingPages: landingPages.flatMap((item) => {
        const slug = isRecord(item) && typeof item.slug === "string" ? item.slug : null
        return slug && LANDING_SLUG_PATTERN.test(slug) && isRecord(item)
          ? [{ slug, updatedAt: readUpdatedAt(item.updated_at) }]
          : []
      }),
    }
  } catch (cause) {
    console.error(`[sitemap] consulta falhou (${cause instanceof Error ? cause.name : "erro"})`)
    return empty
  }
}

import "server-only"

import type { Json } from "@workspace/database/types"

import type { ServerSupabaseClient } from "@/lib/imoveis/queries"
import { LANDING_STATUSES, type LandingStatus } from "@/lib/marketing/constants"
import type { LandingPageRecord } from "@/lib/marketing/db-types"
import { isMissingRelationError } from "@/lib/marketing/errors"
import type { LandingPropertyInput } from "@/lib/marketing/payload"

export type LandingListItem = {
  id: string
  name: string
  template: string
  slug: string
  status: LandingStatus
  publishedAt: string | null
  updatedAt: string
  /** null quando os leads não puderam ser contados. */
  leadCount: number | null
}

export type LandingListResult =
  { available: true; items: LandingListItem[] } | { available: false; items: [] }

function toStatus(value: unknown): LandingStatus {
  return (LANDING_STATUSES as readonly string[]).includes(String(value))
    ? (value as LandingStatus)
    : "draft"
}

export async function listLandingPages(
  supabase: ServerSupabaseClient,
  organizationId: string
): Promise<LandingListResult> {
  const { data, error } = await supabase
    .from("landing_pages")
    .select("id, name, template, slug, status, published_at, updated_at")
    .eq("organization_id", organizationId)
    .order("updated_at", { ascending: false })

  if (error) {
    if (isMissingRelationError(error)) return { available: false, items: [] }
    throw new Error(`Não foi possível carregar as landing pages (${error.code ?? "erro"}).`)
  }

  const rows = data ?? []
  const counts = await countLeadsByLandingPage(
    supabase,
    organizationId,
    rows.map((row) => row.id)
  )

  return {
    available: true,
    items: rows.map((row) => ({
      id: row.id,
      name: row.name,
      template: row.template,
      slug: row.slug,
      status: toStatus(row.status),
      publishedAt: row.published_at,
      updatedAt: row.updated_at,
      leadCount: counts ? (counts.get(row.id) ?? 0) : null,
    })),
  }
}

/**
 * Leads recebidos por página (`leads.landing_page_id`). Conta o que o RLS de
 * `leads` deixa o usuário ver; se a consulta falhar, a lista mostra "—".
 */
async function countLeadsByLandingPage(
  supabase: ServerSupabaseClient,
  organizationId: string,
  pageIds: readonly string[]
): Promise<Map<string, number> | null> {
  if (pageIds.length === 0) return new Map()

  const results = await Promise.all(
    pageIds.map(async (pageId) => {
      const { count, error } = await supabase
        .from("leads")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", organizationId)
        .eq("landing_page_id", pageId)
      return { pageId, count, error }
    })
  )

  if (results.some((result) => result.error)) {
    return null
  }

  return new Map(results.map((result) => [result.pageId, result.count ?? 0]))
}

/** Colunas explícitas (grants por coluna: nunca `*`, nunca created_by). */
const LANDING_PAGE_COLUMNS =
  "id, organization_id, template, name, slug, status, published_at, theme, content, property_ids, tracking, seo, lead_assignee_id, created_at, updated_at" as const

/** Landing page da imobiliária atual; null se não existir nela. */
export async function getLandingPageRow(
  supabase: ServerSupabaseClient,
  organizationId: string,
  pageId: string
): Promise<LandingPageRecord | null> {
  const { data, error } = await supabase
    .from("landing_pages")
    .select(LANDING_PAGE_COLUMNS)
    .eq("organization_id", organizationId)
    .eq("id", pageId)
    .maybeSingle()

  if (error) {
    if (isMissingRelationError(error) || error.code === "22P02") return null
    throw new Error(`Não foi possível carregar a landing page (${error.code ?? "erro"}).`)
  }

  return data
    ? {
        ...data,
        status: toStatus(data.status),
        property_ids: data.property_ids ?? [],
      }
    : null
}

/** Slugs já usados na imobiliária (para sugerir um slug livre). */
export async function getTakenLandingSlugs(
  supabase: ServerSupabaseClient,
  organizationId: string
): Promise<Set<string>> {
  const { data } = await supabase
    .from("landing_pages")
    .select("slug")
    .eq("organization_id", organizationId)

  return new Set((data ?? []).map((row) => row.slug))
}

export type LandingOrganizationRow = {
  id: string
  slug: string
  name: string
  phone: string | null
  email: string | null
  creci: string | null
  city: string | null
  state: string | null
  brand: Json
}

/** Dados públicos da imobiliária (colunas explícitas: feed_token não é legível). */
export async function getLandingOrganization(
  supabase: ServerSupabaseClient,
  organizationId: string
): Promise<LandingOrganizationRow> {
  const { data, error } = await supabase
    .from("organizations")
    .select("id, slug, name, phone, email, creci, city, state, brand")
    .eq("id", organizationId)
    .maybeSingle()

  if (error || !data) {
    throw new Error(`Não foi possível carregar a imobiliária (${error?.code ?? "sem-registro"}).`)
  }

  return data
}

export type LandingMemberRow = {
  id: string
  role: string
  full_name: string | null
  email: string | null
  phone: string | null
  avatar_url: string | null
  creci_number: string | null
  creci_state: string | null
}

/**
 * Membros ativos com os dados de perfil usados no bloco do corretor da
 * landing page. memberships.user_id não tem FK para profiles: duas consultas.
 */
export async function getLandingMembers(
  supabase: ServerSupabaseClient,
  organizationId: string
): Promise<LandingMemberRow[]> {
  const { data: memberships, error } = await supabase
    .from("memberships")
    .select("user_id, role")
    .eq("organization_id", organizationId)
    .eq("active", true)

  if (error) {
    throw new Error(`Não foi possível carregar a equipe (${error.code ?? "erro"}).`)
  }

  const userIds = (memberships ?? []).map((membership) => membership.user_id)
  if (userIds.length === 0) return []

  const { data: profiles } = await supabase
    .from("profiles")
    .select("id, full_name, email, phone, avatar_url, creci_number, creci_state")
    .in("id", userIds)

  const profileById = new Map((profiles ?? []).map((profile) => [profile.id, profile]))

  return (memberships ?? [])
    .map((membership) => {
      const profile = profileById.get(membership.user_id)
      return {
        id: membership.user_id,
        role: membership.role,
        full_name: profile?.full_name ?? null,
        email: profile?.email ?? null,
        phone: profile?.phone ?? null,
        avatar_url: profile?.avatar_url ?? null,
        creci_number: profile?.creci_number ?? null,
        creci_state: profile?.creci_state ?? null,
      }
    })
    .sort((a, b) =>
      (a.full_name ?? a.email ?? "").localeCompare(b.full_name ?? b.email ?? "", "pt-BR")
    )
}

const PROPERTY_MEDIA_LIMIT = 20

/** Colunas do imóvel usadas nas landing pages, com as fotos (literal único para a tipagem do supabase-js). */
export const LANDING_PROPERTY_SELECT =
  "id, code, title, purpose, type, status, sale_price, rent_price, condo_fee, bedrooms, suites, bathrooms, parking_spaces, living_area, lot_area, neighborhood, city, state, features, property_media(storage_path, is_cover, position, kind)" as const

export type LandingPropertySource = LandingPropertyInput

/**
 * Imóveis da imobiliária pelos ids, na ordem recebida (ids de outra
 * imobiliária ou removidos simplesmente não voltam).
 */
export async function getLandingPropertiesByIds(
  supabase: ServerSupabaseClient,
  organizationId: string,
  propertyIds: readonly string[]
): Promise<LandingPropertySource[]> {
  if (propertyIds.length === 0) return []

  const { data, error } = await supabase
    .from("properties")
    .select(LANDING_PROPERTY_SELECT)
    .eq("organization_id", organizationId)
    .in("id", [...new Set(propertyIds)])
    .eq("property_media.kind", "image")
    .order("is_cover", { referencedTable: "property_media", ascending: false })
    .order("position", { referencedTable: "property_media" })
    .limit(PROPERTY_MEDIA_LIMIT, { referencedTable: "property_media" })

  if (error) {
    throw new Error(
      `Não foi possível carregar os imóveis da landing page (${error.code ?? "erro"}).`
    )
  }

  const byId = new Map<string, LandingPropertySource>(
    (data ?? []).map(({ property_media: media, ...property }) => [
      property.id,
      {
        ...property,
        imagePaths: (media ?? [])
          .map((item) => item.storage_path)
          .filter((path): path is string => Boolean(path)),
      },
    ])
  )

  return propertyIds
    .map((id) => byId.get(id))
    .filter((property): property is LandingPropertySource => Boolean(property))
}

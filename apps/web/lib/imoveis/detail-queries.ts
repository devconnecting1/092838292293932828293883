import "server-only"

import { cache } from "react"

import {
  scoreMatch,
  type ClientInterest,
  type PropertyForMatch,
} from "@workspace/core/matching/client-property-match"
import type { Tables } from "@workspace/database/types"

import type {
  AuthorizationItem,
  CaptureOwnerInfo,
  CondominiumSummary,
  KeyItem,
  MatchItem,
  OwnerItem,
  ProposalItem,
} from "@/components/imoveis/detail/types"
import { getPropertyRow, type ServerSupabaseClient } from "@/lib/imoveis/queries"
import { createClient } from "@/lib/supabase/server"

/**
 * Leituras da ficha do imóvel (/imoveis/[id]). Sempre filtradas pela
 * imobiliária atual; o RLS decide o que cada papel enxerga. Falhas viram
 * Error com mensagem pt-BR sem dados pessoais (tratado pelo error.tsx).
 */

type DbError = { code?: string | null }

function loadError(subject: string, error: DbError) {
  return new Error(`Não foi possível carregar ${subject} (${error.code ?? "erro"}).`)
}

/** Embeds do PostgREST podem vir como objeto, lista ou null (RLS). */
function firstEmbed<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null
  return value ?? null
}

function toNumber(value: number | string | null | undefined) {
  if (value == null) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

/** Imóvel da imobiliária, memoizado por requisição (página + metadata). */
export const getPropertyForPage = cache(async (organizationId: string, propertyId: string) => {
  const supabase = await createClient()
  return getPropertyRow(supabase, organizationId, propertyId)
})

export async function getPropertyOwners(
  supabase: ServerSupabaseClient,
  organizationId: string,
  propertyId: string
): Promise<OwnerItem[]> {
  const { data, error } = await supabase
    .from("property_owners")
    .select("id, client_id, share_percent, clients(name, kind)")
    .eq("organization_id", organizationId)
    .eq("property_id", propertyId)
    .order("created_at")

  if (error) throw loadError("os proprietários", error)

  return (data ?? []).map((row) => {
    const client = firstEmbed(row.clients)
    return {
      id: row.id,
      clientId: row.client_id,
      clientName: client?.name ?? null,
      clientKind: client?.kind ?? null,
      sharePercent: toNumber(row.share_percent),
    }
  })
}

export async function getPropertyAuthorizations(
  supabase: ServerSupabaseClient,
  organizationId: string,
  propertyId: string
): Promise<AuthorizationItem[]> {
  const { data, error } = await supabase
    .from("listing_authorizations")
    .select(
      "id, owner_client_id, exclusive, starts_on, ends_on, commission_percent, signed_at, document_path, clients(name)"
    )
    .eq("organization_id", organizationId)
    .eq("property_id", propertyId)
    .order("starts_on", { ascending: false })
    .order("created_at", { ascending: false })

  if (error) throw loadError("as autorizações", error)

  return (data ?? []).map((row) => ({
    id: row.id,
    ownerClientId: row.owner_client_id,
    ownerName: firstEmbed(row.clients)?.name ?? null,
    exclusive: row.exclusive,
    startsOn: row.starts_on,
    endsOn: row.ends_on,
    commissionPercent: toNumber(row.commission_percent),
    signedAt: row.signed_at,
    hasDocument: Boolean(row.document_path),
  }))
}

export async function getCondominiumSummary(
  supabase: ServerSupabaseClient,
  organizationId: string,
  condominiumId: string | null
): Promise<CondominiumSummary | null> {
  if (!condominiumId) return null

  const { data, error } = await supabase
    .from("condominiums")
    .select("id, name")
    .eq("organization_id", organizationId)
    .eq("id", condominiumId)
    .maybeSingle()

  if (error) throw loadError("o condomínio", error)

  return data
}

export async function getPropertyKeys(
  supabase: ServerSupabaseClient,
  organizationId: string,
  propertyId: string
): Promise<KeyItem[]> {
  const { data, error } = await supabase
    .from("keys")
    .select("id, label, location, status")
    .eq("organization_id", organizationId)
    .eq("property_id", propertyId)
    .order("label")
    .limit(100)

  if (error) throw loadError("as chaves", error)

  return data ?? []
}

const PROPOSALS_LIMIT = 50

export async function getPropertyProposals(
  supabase: ServerSupabaseClient,
  organizationId: string,
  propertyId: string
): Promise<ProposalItem[]> {
  const { data, error } = await supabase
    .from("proposals")
    .select("id, client_id, purpose, amount, status, valid_until, created_at, clients(name)")
    .eq("organization_id", organizationId)
    .eq("property_id", propertyId)
    .order("created_at", { ascending: false })
    .limit(PROPOSALS_LIMIT)

  if (error) throw loadError("as propostas", error)

  return (data ?? []).map((row) => ({
    id: row.id,
    clientId: row.client_id,
    clientName: firstEmbed(row.clients)?.name ?? null,
    purpose: row.purpose,
    amount: toNumber(row.amount) ?? 0,
    status: row.status,
    validUntil: row.valid_until,
    createdAt: row.created_at,
  }))
}

const DOCUMENTS_LIMIT = 200

export type PropertyDocumentRow = {
  id: string
  kind: Tables<"property_documents">["kind"]
  description: string | null
  validUntil: string | null
  mimeType: string
  sizeBytes: number
  uploadedBy: string | null
  createdAt: string
}

/** Dossiê do imóvel (o RLS esconde tudo de quem não vê o imóvel restrito). */
export async function getPropertyDocuments(
  supabase: ServerSupabaseClient,
  organizationId: string,
  propertyId: string
): Promise<PropertyDocumentRow[]> {
  const { data, error } = await supabase
    .from("property_documents")
    .select("id, kind, description, valid_until, mime_type, size_bytes, uploaded_by, created_at")
    .eq("organization_id", organizationId)
    .eq("property_id", propertyId)
    .order("created_at", { ascending: false })
    .limit(DOCUMENTS_LIMIT)

  if (error) throw loadError("os documentos", error)

  return (data ?? []).map((row) => ({
    id: row.id,
    kind: row.kind,
    description: row.description,
    validUntil: row.valid_until,
    mimeType: row.mime_type,
    sizeBytes: row.size_bytes,
    uploadedBy: row.uploaded_by,
    createdAt: row.created_at,
  }))
}

/** Pessoas escolhidas para ver o imóvel restrito (property_shares). */
export async function getPropertyShares(
  supabase: ServerSupabaseClient,
  organizationId: string,
  propertyId: string
): Promise<{ userId: string; createdAt: string }[]> {
  const { data, error } = await supabase
    .from("property_shares")
    .select("user_id, created_at")
    .eq("organization_id", organizationId)
    .eq("property_id", propertyId)
    .order("created_at")
    .limit(200)

  if (error) throw loadError("quem tem acesso ao imóvel", error)

  return (data ?? []).map((row) => ({ userId: row.user_id, createdAt: row.created_at }))
}

/** Captação que originou o imóvel. Chame só para papéis que leem captações. */
export async function getConvertedCapture(
  supabase: ServerSupabaseClient,
  organizationId: string,
  propertyId: string
): Promise<CaptureOwnerInfo | null> {
  const { data, error } = await supabase
    .from("capture_requests")
    .select("owner_name, owner_email, owner_phone, created_at")
    .eq("organization_id", organizationId)
    .eq("converted_property_id", propertyId)
    .order("created_at", { ascending: false })
    .limit(1)

  if (error) throw loadError("a captação de origem", error)

  const row = data?.[0]
  if (!row) return null

  return {
    ownerName: row.owner_name,
    ownerEmail: row.owner_email,
    ownerPhone: row.owner_phone,
    createdAt: row.created_at,
  }
}

type InterestRow = Pick<
  Tables<"client_interests">,
  | "id"
  | "purpose"
  | "types"
  | "min_price"
  | "max_price"
  | "min_bedrooms"
  | "min_parking"
  | "neighborhoods"
  | "city"
>

function toClientInterest(row: InterestRow): ClientInterest {
  return {
    purpose: row.purpose,
    types: row.types.length > 0 ? row.types : undefined,
    minPrice: toNumber(row.min_price) ?? undefined,
    maxPrice: toNumber(row.max_price) ?? undefined,
    minBedrooms: toNumber(row.min_bedrooms) ?? undefined,
    minParkingSpaces: toNumber(row.min_parking) ?? undefined,
    neighborhoods: row.neighborhoods.length > 0 ? row.neighborhoods : undefined,
    city: row.city ?? undefined,
  }
}

function toPropertyForMatch(property: Tables<"properties">): PropertyForMatch {
  return {
    purpose: property.purpose,
    type: property.type,
    salePrice: toNumber(property.sale_price) ?? undefined,
    rentPrice: toNumber(property.rent_price) ?? undefined,
    bedrooms: toNumber(property.bedrooms) ?? undefined,
    parkingSpaces: toNumber(property.parking_spaces) ?? undefined,
    neighborhood: property.neighborhood ?? undefined,
    city: property.city ?? undefined,
  }
}

const MAX_MATCH_ROWS = 300
/** Lotes do `in(...)`: mantém a URL do PostgREST curta. */
const INTEREST_CHUNK_SIZE = 100

/**
 * Clientes com interesse ativo compatível (view client_property_matches, que
 * só lista imóveis ativos), pontuados com scoreMatch. Um cliente com vários
 * interesses aparece uma vez, com a melhor pontuação.
 */
export async function getPropertyMatches(
  supabase: ServerSupabaseClient,
  organizationId: string,
  property: Tables<"properties">
): Promise<MatchItem[]> {
  if (property.status !== "active") return []

  const { data, error } = await supabase
    .from("client_property_matches")
    .select("client_interest_id, client_id, client_name")
    .eq("organization_id", organizationId)
    .eq("property_id", property.id)
    .limit(MAX_MATCH_ROWS)

  if (error) throw loadError("os clientes compatíveis", error)

  const rows = (data ?? []).flatMap((row) =>
    row.client_interest_id && row.client_id
      ? [
          {
            interestId: row.client_interest_id,
            clientId: row.client_id,
            clientName: row.client_name,
          },
        ]
      : []
  )

  if (rows.length === 0) return []

  const interestIds = [...new Set(rows.map((row) => row.interestId))]
  const chunks: string[][] = []
  for (let index = 0; index < interestIds.length; index += INTEREST_CHUNK_SIZE) {
    chunks.push(interestIds.slice(index, index + INTEREST_CHUNK_SIZE))
  }

  const responses = await Promise.all(
    chunks.map((ids) =>
      supabase
        .from("client_interests")
        .select(
          "id, purpose, types, min_price, max_price, min_bedrooms, min_parking, neighborhoods, city"
        )
        .eq("organization_id", organizationId)
        .in("id", ids)
    )
  )

  const interests = new Map<string, InterestRow>()
  for (const response of responses) {
    if (response.error) throw loadError("os interesses dos clientes", response.error)
    for (const interest of response.data ?? []) {
      interests.set(interest.id, interest)
    }
  }

  const candidate = toPropertyForMatch(property)
  const bestByClient = new Map<string, MatchItem>()

  for (const row of rows) {
    const interest = interests.get(row.interestId)
    if (!interest) continue

    const result = scoreMatch(toClientInterest(interest), candidate)
    const current = bestByClient.get(row.clientId)

    if (!current || result.score > current.score) {
      bestByClient.set(row.clientId, {
        clientId: row.clientId,
        clientName: row.clientName,
        interestPurpose: interest.purpose,
        score: result.score,
        reasons: result.reasons,
      })
    }
  }

  return [...bestByClient.values()].sort(
    (a, b) => b.score - a.score || (a.clientName ?? "").localeCompare(b.clientName ?? "", "pt-BR")
  )
}

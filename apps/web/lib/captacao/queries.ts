import "server-only"

import type { Enums } from "@workspace/database/types"

import type { createClient } from "@/lib/supabase/server"

type ServerClient = Awaited<ReturnType<typeof createClient>>

export type CaptureStatus = Enums<"capture_request_status">

export type CaptureRow = {
  id: string
  ownerName: string
  ownerEmail: string | null
  ownerPhone: string | null
  purpose: Enums<"listing_purpose">
  type: Enums<"property_type"> | null
  postalCode: string | null
  neighborhood: string | null
  city: string | null
  state: string | null
  expectedPrice: number | null
  message: string | null
  status: CaptureStatus
  consentAt: string
  createdAt: string
  convertedProperty: { id: string; code: string; title: string } | null
}

export type CaptureCounts = Record<CaptureStatus | "all", number>

export async function listCaptureRequests(
  supabase: ServerClient,
  organizationId: string,
  status: CaptureStatus | null
): Promise<{ rows: CaptureRow[]; counts: CaptureCounts }> {
  let rowsQuery = supabase
    .from("capture_requests")
    .select(
      "id, owner_name, owner_email, owner_phone, purpose, type, postal_code, neighborhood, city, state, expected_price, message, status, consent_at, created_at, converted_property:properties!capture_requests_converted_property_fkey(id, code, title)"
    )
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false })
    .limit(500)

  if (status) {
    rowsQuery = rowsQuery.eq("status", status)
  }

  const [rowsResult, countsResult] = await Promise.all([
    rowsQuery,
    supabase
      .from("capture_requests")
      .select("status")
      .eq("organization_id", organizationId)
      .limit(5000),
  ])

  if (rowsResult.error) {
    throw new Error(`Não foi possível carregar as captações (${rowsResult.error.code ?? "erro"}).`)
  }

  if (countsResult.error) {
    throw new Error(`Não foi possível contar as captações (${countsResult.error.code ?? "erro"}).`)
  }

  const counts: CaptureCounts = {
    all: 0,
    new: 0,
    contacted: 0,
    converted: 0,
    discarded: 0,
  }

  for (const row of countsResult.data) {
    counts.all += 1
    counts[row.status] += 1
  }

  return {
    counts,
    rows: rowsResult.data.map((row) => ({
      id: row.id,
      ownerName: row.owner_name,
      ownerEmail: row.owner_email,
      ownerPhone: row.owner_phone,
      purpose: row.purpose,
      type: row.type,
      postalCode: row.postal_code,
      neighborhood: row.neighborhood,
      city: row.city,
      state: row.state,
      expectedPrice: row.expected_price,
      message: row.message,
      status: row.status,
      consentAt: row.consent_at,
      createdAt: row.created_at,
      convertedProperty: row.converted_property
        ? {
            id: row.converted_property.id,
            code: row.converted_property.code,
            title: row.converted_property.title,
          }
        : null,
    })),
  }
}

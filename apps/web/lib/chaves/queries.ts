import "server-only"

import type { Enums } from "@workspace/database/types"

import { getProfileNames } from "@/lib/propostas/options"
import type { createClient } from "@/lib/supabase/server"

type ServerClient = Awaited<ReturnType<typeof createClient>>

export type KeyStatus = Enums<"key_status">

export type KeyFilters = {
  status: KeyStatus | null
  propertyId: string | null
  overdue: boolean
}

export type KeyTakerKind = "member" | "client"

export type OpenKeyMovement = {
  id: string
  takerKind: KeyTakerKind
  takerLabel: string
  takenByUser: string | null
  createdBy: string | null
  takenAt: string
  dueAt: string | null
  isOverdue: boolean
}

export type KeyRow = {
  id: string
  label: string
  location: string | null
  notes: string | null
  status: KeyStatus
  createdAt: string
  property: {
    id: string
    code: string
    title: string
    capturedBy: string | null
    brokerId: string | null
  } | null
  openMovement: OpenKeyMovement | null
}

type TakerSource = {
  taken_by_user: string | null
  taken_by_client_id: string | null
  client: { name: string } | null
}

/** Quem está com a chave: membro da equipe ou cliente. */
export function describeTaker(
  movement: TakerSource,
  names: Map<string, string>
): { kind: KeyTakerKind; label: string } {
  if (movement.taken_by_user) {
    return {
      kind: "member",
      label: names.get(movement.taken_by_user) ?? "Membro da equipe",
    }
  }

  return {
    kind: "client",
    label: movement.client?.name ?? (movement.taken_by_client_id ? "Cliente" : "Não identificado"),
  }
}

export async function listKeys(
  supabase: ServerClient,
  organizationId: string,
  filters: KeyFilters,
  now: Date = new Date()
): Promise<KeyRow[]> {
  let keysQuery = supabase
    .from("keys")
    .select(
      "id, label, location, notes, status, created_at, property:properties!keys_property_fkey(id, code, title, captured_by, broker_id)"
    )
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false })
    .limit(500)

  if (filters.status) {
    keysQuery = keysQuery.eq("status", filters.status)
  }

  if (filters.overdue) {
    keysQuery = keysQuery.eq("status", "checked_out")
  }

  if (filters.propertyId) {
    keysQuery = keysQuery.eq("property_id", filters.propertyId)
  }

  const [keysResult, movementsResult] = await Promise.all([
    keysQuery,
    supabase
      .from("key_movements")
      .select(
        "id, key_id, taken_by_user, taken_by_client_id, taken_at, due_at, created_by, client:clients!key_movements_client_fkey(name)"
      )
      .eq("organization_id", organizationId)
      .is("returned_at", null),
  ])

  if (keysResult.error) {
    throw new Error(`Não foi possível carregar as chaves (${keysResult.error.code ?? "erro"}).`)
  }

  if (movementsResult.error) {
    throw new Error(
      `Não foi possível carregar as retiradas de chaves (${movementsResult.error.code ?? "erro"}).`
    )
  }

  const names = await getProfileNames(
    supabase,
    movementsResult.data.flatMap((movement) =>
      movement.taken_by_user ? [movement.taken_by_user] : []
    )
  )

  const openByKey = new Map<string, OpenKeyMovement>()

  for (const movement of movementsResult.data) {
    const taker = describeTaker(movement, names)

    openByKey.set(movement.key_id, {
      id: movement.id,
      takerKind: taker.kind,
      takerLabel: taker.label,
      takenByUser: movement.taken_by_user,
      createdBy: movement.created_by,
      takenAt: movement.taken_at,
      dueAt: movement.due_at,
      isOverdue: movement.due_at !== null && Date.parse(movement.due_at) < now.getTime(),
    })
  }

  const rows: KeyRow[] = keysResult.data.map((key) => ({
    id: key.id,
    label: key.label,
    location: key.location,
    notes: key.notes,
    status: key.status,
    createdAt: key.created_at,
    property: key.property
      ? {
          id: key.property.id,
          code: key.property.code,
          title: key.property.title,
          capturedBy: key.property.captured_by,
          brokerId: key.property.broker_id,
        }
      : null,
    openMovement: key.status === "checked_out" ? (openByKey.get(key.id) ?? null) : null,
  }))

  const filtered = filters.overdue ? rows.filter((row) => row.openMovement?.isOverdue) : rows

  // Vencidas primeiro, depois as retiradas; o restante mantém a ordem de cadastro.
  const rank = (row: KeyRow) =>
    row.openMovement?.isOverdue ? 0 : row.status === "checked_out" ? 1 : 2

  return filtered
    .map((row, index) => ({ row, index }))
    .sort((a, b) => rank(a.row) - rank(b.row) || a.index - b.index)
    .map(({ row }) => row)
}

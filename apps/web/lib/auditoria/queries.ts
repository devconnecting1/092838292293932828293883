import "server-only"

import type { Json } from "@workspace/database/types"

import type { ServerSupabaseClient } from "@/lib/imoveis/queries"

/**
 * Histórico de alterações (`public.audit_events`). O RLS só deixa dono e
 * gerente lerem, então estas consultas voltam vazias para os demais papéis —
 * `canViewAuditTrail` esconde a aba antes disso.
 */

/** Quantos eventos a ficha mostra (o suficiente para "quem mudou isso?"). */
export const AUDIT_EVENTS_LIMIT = 40

const SELECT = "id, action, entity, entity_id, actor_id, metadata, created_at"

export type AuditEventItem = {
  id: string
  action: string
  entity: string
  entityId: string | null
  actorId: string | null
  /** Nome de quem fez; `null` quando foi o sistema ou um ex-membro. */
  actorName: string | null
  /** Nomes das colunas alteradas (os valores nunca são gravados). */
  changedFields: string[]
  /** Contexto não sensível do gatilho: `code`, `status`, `role`, `active`. */
  metadata: Record<string, unknown>
  createdAt: string
}

export type AuditEventsResult = {
  items: AuditEventItem[]
  /** A consulta falhou (a ficha mostra um aviso em vez de sumir com a aba). */
  failed: boolean
}

type AuditRow = {
  id: string
  action: string
  entity: string
  entity_id: string | null
  actor_id: string | null
  metadata: Json
  created_at: string
}

function toMetadata(value: Json): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function toChangedFields(metadata: Record<string, unknown>) {
  const fields = metadata.changed_fields
  if (!Array.isArray(fields)) return []
  return fields.filter((field): field is string => typeof field === "string")
}

/** Nome de quem agiu. `profiles` só devolve colegas da imobiliária (RLS). */
async function withActorNames(
  supabase: ServerSupabaseClient,
  rows: AuditRow[]
): Promise<AuditEventItem[]> {
  const actorIds = [...new Set(rows.map((row) => row.actor_id).filter((id) => id !== null))]
  const names = new Map<string, string>()

  if (actorIds.length > 0) {
    const { data } = await supabase.from("profiles").select("id, full_name").in("id", actorIds)

    for (const profile of data ?? []) {
      if (profile.full_name) names.set(profile.id, profile.full_name)
    }
  }

  return rows.map((row) => {
    const metadata = toMetadata(row.metadata)

    return {
      id: row.id,
      action: row.action,
      entity: row.entity,
      entityId: row.entity_id,
      actorId: row.actor_id,
      actorName: row.actor_id ? (names.get(row.actor_id) ?? null) : null,
      changedFields: toChangedFields(metadata),
      metadata,
      createdAt: row.created_at,
    }
  })
}

/** Histórico do imóvel: inserção, alterações e exclusão da linha em `properties`. */
export async function getPropertyAuditEvents(
  supabase: ServerSupabaseClient,
  organizationId: string,
  propertyId: string
): Promise<AuditEventsResult> {
  const { data, error } = await supabase
    .from("audit_events")
    .select(SELECT)
    .eq("organization_id", organizationId)
    .eq("entity", "properties")
    .eq("entity_id", propertyId)
    .order("created_at", { ascending: false })
    .limit(AUDIT_EVENTS_LIMIT)

  if (error) return { items: [], failed: true }

  return { items: await withActorNames(supabase, data ?? []), failed: false }
}

/**
 * Histórico do cliente: a ficha (`clients`, por `entity_id`) mais os documentos
 * (`client_documents`, que só guardam o cliente em `metadata.client_id` — daí o
 * índice parcial `audit_events_client_documents_idx`).
 */
export async function getClientAuditEvents(
  supabase: ServerSupabaseClient,
  organizationId: string,
  clientId: string
): Promise<AuditEventsResult> {
  const [clientRows, documentRows] = await Promise.all([
    supabase
      .from("audit_events")
      .select(SELECT)
      .eq("organization_id", organizationId)
      .eq("entity", "clients")
      .eq("entity_id", clientId)
      .order("created_at", { ascending: false })
      .limit(AUDIT_EVENTS_LIMIT),
    supabase
      .from("audit_events")
      .select(SELECT)
      .eq("organization_id", organizationId)
      .eq("entity", "client_documents")
      .eq("metadata->>client_id", clientId)
      .order("created_at", { ascending: false })
      .limit(AUDIT_EVENTS_LIMIT),
  ])

  if (clientRows.error || documentRows.error) {
    return { items: [], failed: true }
  }

  const merged = [...(clientRows.data ?? []), ...(documentRows.data ?? [])]
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .slice(0, AUDIT_EVENTS_LIMIT)

  return { items: await withActorNames(supabase, merged), failed: false }
}

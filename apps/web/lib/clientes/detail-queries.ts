import "server-only"

import {
  scoreMatch,
  type ClientInterest,
  type PropertyForMatch,
} from "@workspace/core/matching/client-property-match"
import type { Enums, Tables } from "@workspace/database/types"

import { createClient } from "@/lib/supabase/server"

export type PropertyRef = { id: string; code: string; title: string }

export type ClientActivityItem = {
  id: string
  type: Enums<"activity_type">
  body: string | null
  occurredAt: string
  createdBy: string | null
  property: PropertyRef | null
}

export type ClientAppointmentItem = {
  id: string
  startsAt: string
  endsAt: string | null
  status: Enums<"appointment_status">
  brokerId: string | null
  createdBy: string | null
  meetingPoint: string | null
  property: PropertyRef | null
}

export type ClientTaskItem = {
  id: string
  title: string
  description: string | null
  status: Enums<"task_status">
  priority: Enums<"task_priority">
  dueAt: string | null
  assigneeId: string | null
  createdBy: string | null
  property: PropertyRef | null
}

export type ClientDocumentItem = {
  id: string
  name: string
  mimeType: string | null
  sizeBytes: number | null
  uploadedBy: string | null
  createdAt: string
}

export type ClientShareItem = {
  id: string
  userId: string
  sharedBy: string | null
  createdAt: string
}

export type ClientMatchItem = {
  propertyId: string
  code: string
  title: string
  type: Enums<"property_type">
  purpose: Enums<"listing_purpose">
  interestPurpose: Enums<"listing_purpose">
  salePrice: number | null
  rentPrice: number | null
  bedrooms: number | null
  parkingSpaces: number | null
  neighborhood: string | null
  city: string | null
  imobScore: number | null
  score: number
  reasons: string[]
}

const MAX_MATCHES = 50

function toMatchInterest(interest: Tables<"client_interests">): ClientInterest {
  const result: ClientInterest = {
    purpose: interest.purpose,
    types: interest.types,
    neighborhoods: interest.neighborhoods,
  }

  if (interest.min_price !== null) result.minPrice = interest.min_price
  if (interest.max_price !== null) result.maxPrice = interest.max_price
  if (interest.min_bedrooms !== null) result.minBedrooms = interest.min_bedrooms
  if (interest.min_parking !== null) result.minParkingSpaces = interest.min_parking
  if (interest.city) result.city = interest.city

  return result
}

type MatchRow = Tables<"client_property_matches">

function toMatchProperty(
  row: MatchRow,
  type: Enums<"property_type">,
  purpose: Enums<"listing_purpose">
): PropertyForMatch {
  const result: PropertyForMatch = { purpose, type }

  if (row.sale_price !== null) result.salePrice = row.sale_price
  if (row.rent_price !== null) result.rentPrice = row.rent_price
  if (row.bedrooms !== null) result.bedrooms = row.bedrooms
  if (row.parking_spaces !== null) result.parkingSpaces = row.parking_spaces
  if (row.neighborhood) result.neighborhood = row.neighborhood
  if (row.city) result.city = row.city

  return result
}

/**
 * Uma entrada por imóvel (o melhor score entre os perfis ativos), ordenada por
 * `scoreMatch`. A view já filtrou os candidatos por finalidade, tipo e preço.
 */
function rankMatches(rows: MatchRow[], interests: Tables<"client_interests">[]) {
  const interestById = new Map(interests.map((interest) => [interest.id, interest]))
  const best = new Map<string, ClientMatchItem>()

  for (const row of rows) {
    const interest = row.client_interest_id ? interestById.get(row.client_interest_id) : undefined

    if (
      !interest ||
      !row.property_id ||
      !row.property_code ||
      !row.property_title ||
      !row.property_type ||
      !row.property_purpose
    ) {
      continue
    }

    const { score, reasons } = scoreMatch(
      toMatchInterest(interest),
      toMatchProperty(row, row.property_type, row.property_purpose)
    )
    const current = best.get(row.property_id)

    if (!current || score > current.score) {
      best.set(row.property_id, {
        propertyId: row.property_id,
        code: row.property_code,
        title: row.property_title,
        type: row.property_type,
        purpose: row.property_purpose,
        interestPurpose: interest.purpose,
        salePrice: row.sale_price,
        rentPrice: row.rent_price,
        bedrooms: row.bedrooms,
        parkingSpaces: row.parking_spaces,
        neighborhood: row.neighborhood,
        city: row.city,
        imobScore: row.imob_score,
        score,
        reasons,
      })
    }
  }

  return [...best.values()]
    .sort((a, b) => b.score - a.score || (b.imobScore ?? 0) - (a.imobScore ?? 0))
    .slice(0, MAX_MATCHES)
}

/** Tudo o que as abas da ficha precisam, em paralelo e sempre filtrado pela imobiliária. */
export async function getClientDetailData(organizationId: string, clientId: string) {
  const supabase = await createClient()

  const [
    activitiesResult,
    interestsResult,
    documentsResult,
    sharesResult,
    matchesResult,
    appointmentsResult,
    openTasksResult,
    doneTasksResult,
    ownerResult,
  ] = await Promise.all([
    supabase
      .from("activities")
      .select("id, type, body, occurred_at, created_by, property_id")
      .eq("organization_id", organizationId)
      .eq("client_id", clientId)
      .order("occurred_at", { ascending: false })
      .limit(100),
    supabase
      .from("client_interests")
      .select("*")
      .eq("organization_id", organizationId)
      .eq("client_id", clientId)
      .order("created_at"),
    supabase
      .from("client_documents")
      .select("id, name, mime_type, size_bytes, uploaded_by, created_at")
      .eq("organization_id", organizationId)
      .eq("client_id", clientId)
      .order("created_at", { ascending: false }),
    supabase
      .from("client_shares")
      .select("id, user_id, shared_by, created_at")
      .eq("organization_id", organizationId)
      .eq("client_id", clientId)
      .order("created_at"),
    supabase
      .from("client_property_matches")
      .select("*")
      .eq("organization_id", organizationId)
      .eq("client_id", clientId)
      .limit(500),
    supabase
      .from("appointments")
      .select("id, starts_at, ends_at, status, broker_id, created_by, meeting_point, property_id")
      .eq("organization_id", organizationId)
      .eq("client_id", clientId)
      .order("starts_at", { ascending: false })
      .limit(10),
    supabase
      .from("tasks")
      .select(
        "id, title, description, status, priority, due_at, assignee_id, created_by, property_id"
      )
      .eq("organization_id", organizationId)
      .eq("client_id", clientId)
      .eq("status", "open")
      .order("due_at", { ascending: true, nullsFirst: false })
      .limit(10),
    supabase
      .from("tasks")
      .select(
        "id, title, description, status, priority, due_at, assignee_id, created_by, property_id"
      )
      .eq("organization_id", organizationId)
      .eq("client_id", clientId)
      .eq("status", "done")
      .order("completed_at", { ascending: false })
      .limit(5),
    supabase
      .from("property_owners")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", organizationId)
      .eq("client_id", clientId),
  ])

  const propertyIds = new Set<string>()

  for (const row of [
    ...(activitiesResult.data ?? []),
    ...(appointmentsResult.data ?? []),
    ...(openTasksResult.data ?? []),
    ...(doneTasksResult.data ?? []),
  ]) {
    if (row.property_id) propertyIds.add(row.property_id)
  }

  const propertyById = new Map<string, PropertyRef>()

  if (propertyIds.size > 0) {
    const { data } = await supabase
      .from("properties")
      .select("id, code, title")
      .eq("organization_id", organizationId)
      .in("id", [...propertyIds])

    for (const property of data ?? []) {
      propertyById.set(property.id, property)
    }
  }

  const propertyFor = (id: string | null) => (id ? (propertyById.get(id) ?? null) : null)
  const interests = interestsResult.data ?? []

  const mapTask = (task: NonNullable<typeof openTasksResult.data>[number]): ClientTaskItem => ({
    id: task.id,
    title: task.title,
    description: task.description,
    status: task.status,
    priority: task.priority,
    dueAt: task.due_at,
    assigneeId: task.assignee_id,
    createdBy: task.created_by,
    property: propertyFor(task.property_id),
  })

  return {
    activities: (activitiesResult.data ?? []).map((activity): ClientActivityItem => ({
      id: activity.id,
      type: activity.type,
      body: activity.body,
      occurredAt: activity.occurred_at,
      createdBy: activity.created_by,
      property: propertyFor(activity.property_id),
    })),
    activitiesFailed: Boolean(activitiesResult.error),
    interests,
    interestsFailed: Boolean(interestsResult.error),
    documents: (documentsResult.data ?? []).map((document): ClientDocumentItem => ({
      id: document.id,
      name: document.name,
      mimeType: document.mime_type,
      sizeBytes: document.size_bytes,
      uploadedBy: document.uploaded_by,
      createdAt: document.created_at,
    })),
    documentsFailed: Boolean(documentsResult.error),
    shares: (sharesResult.data ?? []).map((share): ClientShareItem => ({
      id: share.id,
      userId: share.user_id,
      sharedBy: share.shared_by,
      createdAt: share.created_at,
    })),
    matches: rankMatches(matchesResult.data ?? [], interests),
    matchesFailed: Boolean(matchesResult.error),
    appointments: (appointmentsResult.data ?? []).map((appointment): ClientAppointmentItem => ({
      id: appointment.id,
      startsAt: appointment.starts_at,
      endsAt: appointment.ends_at,
      status: appointment.status,
      brokerId: appointment.broker_id,
      createdBy: appointment.created_by,
      meetingPoint: appointment.meeting_point,
      property: propertyFor(appointment.property_id),
    })),
    appointmentsFailed: Boolean(appointmentsResult.error),
    openTasks: (openTasksResult.data ?? []).map(mapTask),
    doneTasks: (doneTasksResult.data ?? []).map(mapTask),
    tasksFailed: Boolean(openTasksResult.error || doneTasksResult.error),
    isPropertyOwner: (ownerResult.count ?? 0) > 0,
  }
}

export type ClientDetailData = Awaited<ReturnType<typeof getClientDetailData>>

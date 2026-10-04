import "server-only"

import { cache } from "react"

import {
  addDays,
  formatPeriodLabel,
  isReportPeriodPreset,
  REPORT_PERIOD_PRESET_LABELS,
  todayInBrasilia,
} from "@workspace/core/reports/period"
import type { Json } from "@workspace/database/types"

import { isRole, type Role } from "@/lib/auth/roles"
import { DEFAULT_EXPORT_ROLES, normalizeExportRoles } from "@/lib/configuracoes/export-permissions"
import { isReportDataset, REPORT_DATASET_LABELS } from "@/lib/relatorios/datasets"
import { createClient } from "@/lib/supabase/server"

/**
 * Leituras da permissão de exportar e da trilha de exportações.
 *
 * - `organization_permission_settings` é legível por qualquer membro (a tela
 *   precisa saber se desenha o botão);
 * - `audit_events` só volta para dono e gerente (RLS), então a lista chega
 *   vazia para os demais papéis — a página nem chama.
 */

/** Papéis que exportam nesta imobiliária. Falha de leitura cai no padrão. */
export const getExportRoles = cache(async (organizationId: string): Promise<Role[]> => {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from("organization_permission_settings")
    .select("export_roles")
    .eq("organization_id", organizationId)
    .maybeSingle()

  if (error || !data) {
    return [...DEFAULT_EXPORT_ROLES]
  }

  return normalizeExportRoles(data.export_roles)
})

/** Quantas exportações a tela mostra. */
export const EXPORT_AUDIT_LIMIT = 50

export type ExportAuditItem = {
  id: string
  createdAt: string
  /** Nome (ou e-mail) de quem exportou; `null` quando a pessoa saiu da equipe. */
  actorName: string | null
  /** Papel no momento da exportação. */
  role: Role | null
  datasetLabel: string
  allowed: boolean
  rows: number
  periodLabel: string | null
  /** Corretor escolhido no filtro por dono ou gerente. */
  brokerName: string | null
  /** Papel sem visão da equipe: o arquivo só trouxe os registros da própria pessoa. */
  ownRecordsOnly: boolean
}

export type ExportAuditResult = {
  items: ExportAuditItem[]
  failed: boolean
}

function asObject(value: Json | undefined): Record<string, Json | undefined> {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {}
}

function asString(value: Json | undefined) {
  return typeof value === "string" && value.length > 0 ? value : null
}

/** "Últimos 30 dias (18/08/2026 a 16/09/2026)" a partir do intervalo gravado. */
function describePeriod(filters: Record<string, Json | undefined>) {
  const from = asString(filters.from)
  const to = asString(filters.to)

  if (!from || !to) return null

  const fromDate = new Date(from)
  const toDate = new Date(to)

  if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime())) return null

  // `to` é exclusivo (meia-noite do dia seguinte ao último dia).
  const fromDay = todayInBrasilia(fromDate)
  const toDay = addDays(todayInBrasilia(toDate), -1)
  const range = formatPeriodLabel(fromDay, toDay < fromDay ? fromDay : toDay)
  const preset = asString(filters.period_preset)

  return isReportPeriodPreset(preset) ? `${REPORT_PERIOD_PRESET_LABELS[preset]} (${range})` : range
}

export async function getExportAuditEvents(organizationId: string): Promise<ExportAuditResult> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from("audit_events")
    .select("id, actor_id, metadata, created_at")
    .eq("organization_id", organizationId)
    .eq("entity", "data_export")
    .order("created_at", { ascending: false })
    .limit(EXPORT_AUDIT_LIMIT)

  if (error) {
    return { items: [], failed: true }
  }

  const rows = data ?? []
  const personIds = new Set<string>()

  for (const row of rows) {
    if (row.actor_id) personIds.add(row.actor_id)
    const brokerId = asString(asObject(asObject(row.metadata).filters).broker_id)
    if (brokerId) personIds.add(brokerId)
  }

  const names = new Map<string, string>()

  if (personIds.size > 0) {
    // `profiles` só devolve colegas da imobiliária (RLS).
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, full_name, email")
      .in("id", [...personIds])

    for (const profile of profiles ?? []) {
      const name = profile.full_name?.trim() || profile.email
      if (name) names.set(profile.id, name)
    }
  }

  const items = rows.map((row): ExportAuditItem => {
    const metadata = asObject(row.metadata)
    const filters = asObject(metadata.filters)
    const dataset = asString(metadata.dataset)
    const role = asString(metadata.role)
    const brokerId = asString(filters.broker_id)
    const seesTeam = role === "owner" || role === "manager"
    const rowsValue = Number(metadata.rows)

    return {
      id: row.id,
      createdAt: row.created_at,
      actorName: row.actor_id ? (names.get(row.actor_id) ?? null) : null,
      role: isRole(role) ? role : null,
      datasetLabel: isReportDataset(dataset) ? REPORT_DATASET_LABELS[dataset] : "Dados",
      allowed: metadata.allowed === true,
      rows: Number.isFinite(rowsValue) && rowsValue > 0 ? Math.floor(rowsValue) : 0,
      periodLabel: describePeriod(filters),
      brokerName:
        seesTeam && brokerId ? (names.get(brokerId) ?? "corretor que saiu da equipe") : null,
      ownRecordsOnly: role !== null && !seesTeam,
    }
  })

  return { items, failed: false }
}

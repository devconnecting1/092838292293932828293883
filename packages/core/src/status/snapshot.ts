/**
 * Página de status — leitura do JSON de `public.get_public_status()`.
 *
 * O banco devolve o retrato no formato de `PublicStatusSnapshot`; aqui ele é
 * conferido campo a campo (nada fora do contrato passa adiante) e o nome e a
 * descrição de cada parte vêm do core (`STATUS_COMPONENTS`), na ordem da
 * página. Formato inesperado = null (a tela mostra "não foi possível verificar").
 */

import { z } from "zod"

import { overallStatusLevel } from "./levels"
import {
  STATUS_COMPONENT_KEYS,
  STATUS_COMPONENTS,
  STATUS_LEVELS,
  type PublicIncident,
  type PublicStatusComponent,
  type PublicStatusSnapshot,
} from "./public"

const levelSchema = z.enum(STATUS_LEVELS)
const componentKeySchema = z.enum(STATUS_COMPONENT_KEYS)
const statusSchema = z.enum([
  "investigating",
  "identified",
  "monitoring",
  "resolved",
  "scheduled",
  "in_progress",
  "completed",
])
const timestampSchema = z.string().refine((value) => !Number.isNaN(Date.parse(value)))
const dateKeySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)

const daySchema = z.object({
  date: dateKeySchema,
  uptimePct: z.number().min(0).max(100).nullable(),
  worstLevel: levelSchema,
  incidentIds: z.array(z.string()),
})

const componentSchema = z.object({
  key: componentKeySchema,
  level: levelSchema,
  // Retratos antigos não trazem o sinal: ausente = não informado.
  automaticSignal: z.boolean().optional(),
  uptime90dPct: z.number().min(0).max(100).nullable(),
  days: z.array(daySchema),
})

const incidentSchema = z.object({
  id: z.string(),
  kind: z.enum(["incident", "maintenance"]),
  title: z.string(),
  impact: z.enum(["none", "minor", "major", "critical"]),
  status: statusSchema,
  componentKeys: z.array(componentKeySchema),
  startedAt: timestampSchema,
  resolvedAt: timestampSchema.nullable(),
  scheduledFor: timestampSchema.nullable(),
  scheduledUntil: timestampSchema.nullable(),
  // Retratos antigos não trazem a origem: ausente = equipe.
  source: z.enum(["automatic", "team"]).optional(),
  updates: z.array(
    z.object({
      status: statusSchema,
      message: z.string(),
      createdAt: timestampSchema,
    })
  ),
})

const snapshotSchema = z.object({
  generatedAt: timestampSchema,
  lastCheckedAt: timestampSchema.nullable(),
  overall: levelSchema,
  components: z.array(componentSchema),
  activeIncidents: z.array(incidentSchema),
  upcomingMaintenances: z.array(incidentSchema),
  pastIncidents: z.array(incidentSchema),
})

function toIncident(incident: z.infer<typeof incidentSchema>): PublicIncident {
  return {
    id: incident.id,
    kind: incident.kind,
    title: incident.title,
    impact: incident.impact,
    status: incident.status,
    componentKeys: incident.componentKeys,
    startedAt: incident.startedAt,
    resolvedAt: incident.resolvedAt,
    scheduledFor: incident.scheduledFor,
    scheduledUntil: incident.scheduledUntil,
    source: incident.source ?? "team",
    updates: incident.updates.map((update) => ({
      status: update.status,
      message: update.message,
      createdAt: update.createdAt,
    })),
  }
}

/** Confere o JSON da RPC pública; null se o formato não bater com o contrato. */
export function parsePublicStatusSnapshot(value: unknown): PublicStatusSnapshot | null {
  const parsed = snapshotSchema.safeParse(value)

  if (!parsed.success) {
    return null
  }

  const byKey = new Map(parsed.data.components.map((component) => [component.key, component]))
  const components: PublicStatusComponent[] = []

  for (const info of STATUS_COMPONENTS) {
    const component = byKey.get(info.key)

    if (!component) {
      return null
    }

    components.push({
      key: info.key,
      name: info.name,
      description: info.description,
      level: component.level,
      ...(component.automaticSignal === undefined
        ? {}
        : { automaticSignal: component.automaticSignal }),
      uptime90dPct: component.uptime90dPct,
      days: component.days.map((day) => ({
        date: day.date,
        uptimePct: day.uptimePct,
        worstLevel: day.worstLevel,
        incidentIds: day.incidentIds,
      })),
    })
  }

  return {
    generatedAt: parsed.data.generatedAt,
    lastCheckedAt: parsed.data.lastCheckedAt,
    // Recalculado das partes: a regra fica num lugar só (levels.ts), igual à do banco.
    overall: overallStatusLevel(components.map((component) => component.level)),
    components,
    activeIncidents: parsed.data.activeIncidents.map(toIncident),
    upcomingMaintenances: parsed.data.upcomingMaintenances.map(toIncident),
    pastIncidents: parsed.data.pastIncidents.map(toIncident),
  }
}

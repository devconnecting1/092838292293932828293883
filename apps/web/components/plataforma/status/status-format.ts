import { INCIDENT_IMPACT_LEVEL } from "@workspace/core/status/levels"
import {
  STATUS_COMPONENTS,
  STATUS_LEVEL_LABELS,
  type IncidentImpact,
  type StatusComponentKey,
} from "@workspace/core/status/public"

import { formatNumber } from "@/lib/format"

/** Disponibilidade no formato da página pública ("99,95%"); sem medição quando null. */
export function formatUptime(pct: number | null | undefined): string {
  return pct == null ? "Sem medição" : `${formatNumber(pct)}%`
}

const COMPONENT_NAMES = new Map(
  STATUS_COMPONENTS.map((component) => [component.key, component.name])
)

export function statusComponentName(key: StatusComponentKey): string {
  return COMPONENT_NAMES.get(key) ?? key
}

/** Nomes das partes afetadas na ordem da página, separados por vírgula. */
export function statusComponentNames(keys: readonly StatusComponentKey[]): string {
  return keys.length === 0 ? "—" : keys.map(statusComponentName).join(", ")
}

/** "Impacto pequeno → Lentidão": o nível que o incidente em aberto impõe às partes. */
export function impactLevelLabel(impact: IncidentImpact): string {
  return STATUS_LEVEL_LABELS[INCIDENT_IMPACT_LEVEL[impact]]
}

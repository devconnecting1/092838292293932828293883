import "server-only"

import {
  GOAL_METRICS,
  monthFirstDay,
  type GoalMetric,
  type GoalValues,
} from "@workspace/core/reports/sales-goals"

import { isRole, type Role } from "@/lib/auth/roles"
import { logReportFailure, toNullableNumber, toNumber, toText } from "@/lib/relatorios/parse"
import { reportFilterArgs } from "@/lib/relatorios/queries"
import { createClient } from "@/lib/supabase/server"

/**
 * Aba Metas: uma linha por equipe (só dono, gerente e líder recebem) e uma por
 * corretor, com a meta do mês (`null` = sem meta naquele indicador) e o
 * realizado, tudo de `report_sales_goals`. Quem vê o quê é decidido no banco.
 */

export type GoalTargetKind = "team" | "broker"

export type GoalReportRow = {
  kind: GoalTargetKind
  /** Id da equipe (kind team) ou do corretor (kind broker). */
  targetId: string
  name: string
  role: Role | null
  active: boolean
  teamId: string | null
  teamName: string | null
  goal: GoalValues<number | null>
  actual: GoalValues<number>
}

export type GoalReport = {
  teams: GoalReportRow[]
  brokers: GoalReportRow[]
  failed: boolean
}

export type GoalScope = {
  organizationId: string
  /** "AAAA-MM" */
  month: string
  broker: string | null
  team: string | null
}

/** Coluna da RPC para cada indicador (meta = `goal_` + coluna). */
const METRIC_COLUMNS: Record<GoalMetric, string> = {
  leadsAnswered: "leads_answered",
  visits: "visits",
  proposals: "proposals",
  salesCount: "sales_count",
  salesAmount: "sales_amount",
  rentalsCount: "rentals_count",
  rentalsAmount: "rentals_amount",
}

export async function loadGoalReport(scope: GoalScope): Promise<GoalReport> {
  try {
    const supabase = await createClient()
    const { data, error } = await supabase.rpc("report_sales_goals", {
      p_organization_id: scope.organizationId,
      p_month: monthFirstDay(scope.month),
      ...reportFilterArgs(scope),
    })

    if (error) {
      logReportFailure("as metas", error)
      return { teams: [], brokers: [], failed: true }
    }

    const teams: GoalReportRow[] = []
    const brokers: GoalReportRow[] = []

    for (const row of data ?? []) {
      const record = row as unknown as Record<string, unknown>
      const goal = Object.fromEntries(
        GOAL_METRICS.map((metric) => [
          metric,
          toNullableNumber(record[`goal_${METRIC_COLUMNS[metric]}`]),
        ])
      ) as GoalValues<number | null>
      const actual = Object.fromEntries(
        GOAL_METRICS.map((metric) => [metric, toNumber(record[METRIC_COLUMNS[metric]])])
      ) as GoalValues<number>

      const item: GoalReportRow = {
        kind: row.kind === "team" ? "team" : "broker",
        targetId: row.target_id,
        name: toText(row.name) ?? (row.kind === "team" ? "Equipe sem nome" : "Membro sem nome"),
        role: isRole(row.member_role) ? row.member_role : null,
        active: row.member_active !== false,
        teamId: toText(row.team_id),
        teamName: toText(row.team_name),
        goal,
        actual,
      }

      if (item.kind === "team") {
        teams.push(item)
      } else {
        brokers.push(item)
      }
    }

    return { teams, brokers, failed: false }
  } catch (error) {
    logReportFailure("as metas", error)
    return { teams: [], brokers: [], failed: true }
  }
}

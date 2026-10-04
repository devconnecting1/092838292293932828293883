import "server-only"

import type { ProposalStatus } from "@workspace/core/properties/enums"
import {
  forecastByBroker,
  isForecastBucket,
  isForecastPurpose,
  summarizeForecast,
  type BrokerForecast,
  type ForecastRow,
  type ForecastSummary,
} from "@workspace/core/reports/sales-forecast"

import { logReportFailure, toNullableNumber, toNumber, toText } from "@/lib/relatorios/parse"
import { reportFilterArgs } from "@/lib/relatorios/queries"
import { createClient } from "@/lib/supabase/server"

/**
 * Aba Previsão: `report_sales_forecast` (somas por corretor, faixa da data
 * prevista e finalidade) e `report_forecast_proposals` (propostas em aberto,
 * sem dado do cliente, com a probabilidade da etapa e se a sessão pode editar a
 * data prevista). O recorte por papel é do banco.
 */

export type ForecastScope = {
  organizationId: string
  broker: string | null
  team: string | null
}

export type ForecastReport = {
  summary: ForecastSummary
  brokers: BrokerForecast[]
  failed: boolean
}

export async function loadForecastReport(scope: ForecastScope): Promise<ForecastReport> {
  try {
    const supabase = await createClient()
    const { data, error } = await supabase.rpc("report_sales_forecast", {
      p_organization_id: scope.organizationId,
      ...reportFilterArgs(scope),
    })

    if (error) {
      logReportFailure("a previsão de vendas", error)
      return { summary: summarizeForecast([]), brokers: [], failed: true }
    }

    const rows: ForecastRow[] = []

    for (const row of data ?? []) {
      if (!isForecastBucket(row.bucket) || !isForecastPurpose(row.purpose)) {
        continue
      }

      rows.push({
        userId: toText(row.user_id),
        name: toText(row.full_name) ?? "Membro sem nome",
        teamId: toText(row.team_id),
        teamName: toText(row.team_name),
        bucket: row.bucket,
        purpose: row.purpose,
        proposals: toNumber(row.proposals),
        amount: toNumber(row.amount),
        weightedAmount: toNumber(row.weighted_amount),
      })
    }

    return { summary: summarizeForecast(rows), brokers: forecastByBroker(rows), failed: false }
  } catch (error) {
    logReportFailure("a previsão de vendas", error)
    return { summary: summarizeForecast([]), brokers: [], failed: true }
  }
}

export type StageProbability = {
  status: ProposalStatus
  probability: number
  isDefault: boolean
}

/** Probabilidade em vigor por etapa em aberto (a do dono ou a padrão). Vazio se falhar. */
export async function loadStageProbabilities(organizationId: string): Promise<StageProbability[]> {
  try {
    const supabase = await createClient()
    const { data, error } = await supabase.rpc("get_proposal_stage_probabilities", {
      p_organization_id: organizationId,
    })

    if (error) {
      logReportFailure("a probabilidade por etapa", error)
      return []
    }

    return (data ?? []).map((row) => ({
      status: row.status,
      probability: toNumber(row.probability),
      isDefault: row.is_default === true,
    }))
  } catch (error) {
    logReportFailure("a probabilidade por etapa", error)
    return []
  }
}

export type ForecastProposal = {
  id: string
  createdAt: string
  propertyCode: string | null
  propertyTitle: string | null
  brokerName: string | null
  teamName: string | null
  purpose: "sale" | "rent"
  amount: number
  status: ProposalStatus
  /** Probabilidade da etapa em vigor (0 a 100). */
  probability: number | null
  expectedCloseDate: string | null
  validUntil: string | null
  canEdit: boolean
}

export type ForecastProposalList = {
  proposals: ForecastProposal[]
  /** A lista veio no teto pedido: pode haver mais propostas em aberto. */
  truncated: boolean
  failed: boolean
}

/** Teto de propostas lidas para a lista (a RPC aceita até 500). */
export const FORECAST_PROPOSALS_LIMIT = 300

export async function loadForecastProposals(scope: ForecastScope): Promise<ForecastProposalList> {
  try {
    const supabase = await createClient()
    const { data, error } = await supabase.rpc("report_forecast_proposals", {
      p_organization_id: scope.organizationId,
      p_limit: FORECAST_PROPOSALS_LIMIT,
      ...reportFilterArgs(scope),
    })

    if (error) {
      logReportFailure("as propostas em aberto", error)
      return { proposals: [], truncated: false, failed: true }
    }

    const proposals: ForecastProposal[] = []

    for (const row of data ?? []) {
      if (!isForecastPurpose(row.purpose)) {
        continue
      }

      proposals.push({
        id: row.id,
        createdAt: row.created_at,
        propertyCode: toText(row.property_code),
        propertyTitle: toText(row.property_title),
        brokerName: toText(row.broker_name),
        teamName: toText(row.team_name),
        purpose: row.purpose,
        amount: toNumber(row.amount),
        status: row.status,
        probability: toNullableNumber(row.probability),
        expectedCloseDate: toText(row.expected_close_date),
        validUntil: toText(row.valid_until),
        canEdit: row.can_edit === true,
      })
    }

    return {
      proposals,
      truncated: (data ?? []).length >= FORECAST_PROPOSALS_LIMIT,
      failed: false,
    }
  } catch (error) {
    logReportFailure("as propostas em aberto", error)
    return { proposals: [], truncated: false, failed: true }
  }
}

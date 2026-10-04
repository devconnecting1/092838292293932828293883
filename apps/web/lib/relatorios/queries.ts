import "server-only"

import { leadCost, sumInvestment } from "@workspace/core/reports/lead-cost"
import type { ReportPeriod } from "@workspace/core/reports/period"
import {
  brokerRates,
  rate,
  stageRates,
  type BrokerRates,
  type StageRates,
} from "@workspace/core/reports/rates"
import { sumFields } from "@workspace/core/reports/team-subtotals"

import type { Role } from "@/lib/auth/roles"
import { isRole } from "@/lib/auth/roles"
import { LEAD_SOURCE_LABELS, LEAD_STAGE_LABELS, LEAD_STAGES } from "@/lib/leads/constants"
import type { LeadSource, LeadStage } from "@/lib/leads/db-types"
import {
  logReportFailure as logFailure,
  toNullableNumber,
  toNumber,
  toText,
} from "@/lib/relatorios/parse"
import { createClient } from "@/lib/supabase/server"

/**
 * Dados da tela /relatorios.
 *
 * Toda soma acontece no Postgres, nas RPCs da migração
 * `gestao_comercial_equipes_metas`: o Node recebe uma linha por corretor, uma
 * por etapa e uma por origem — nunca a lista de leads, de imóveis ou de
 * clientes. O recorte por papel (dono e gerente escolhem equipe ou corretor, o
 * líder fica nas equipes que lidera, os demais veem só o próprio número) é
 * aplicado dentro da própria RPC, em `private.report_member_scope`.
 *
 * Falha não derruba a página: cada relatório volta com `failed: true` e a tela
 * mostra o aviso no lugar daquele bloco.
 */

export type ReportScope = {
  organizationId: string
  period: ReportPeriod
  /** Corretor escolhido no filtro. A RPC ignora o que estiver fora do recorte do papel. */
  broker: string | null
  /** Equipe escolhida no filtro. O líder só filtra as equipes que lidera. */
  team: string | null
}

/** Parâmetros de corretor e equipe, omitidos quando vazios (a RPC usa null). */
export function reportFilterArgs(scope: Pick<ReportScope, "broker" | "team">) {
  return {
    ...(scope.broker ? { p_user_id: scope.broker } : {}),
    ...(scope.team ? { p_team_id: scope.team } : {}),
  }
}

// -----------------------------------------------------------------------------
// Desempenho por corretor
// -----------------------------------------------------------------------------

export type BrokerReportRow = {
  userId: string
  name: string
  role: Role | null
  active: boolean
  /** Equipe ATUAL do corretor (o banco não guarda histórico de equipe). */
  teamId: string | null
  teamName: string | null
  leadsReceived: number
  leadsAnswered: number
  leadsInSla: number
  leadsWon: number
  leadsLost: number
  leadsOpen: number
  /** Leads que a roleta tirou do corretor por estouro do prazo (número de gestão). */
  leadsTakenBySla: number
  firstResponseMedianMinutes: number | null
  propertiesCaptured: number
  proposalsMade: number
  proposalsClosed: number
  /** Propostas de venda aceitas no período e a soma delas. */
  salesClosed: number
  salesClosedAmount: number
  /** Propostas de locação aceitas no período e a soma delas. */
  rentalsClosed: number
  rentalsClosedAmount: number
  rates: BrokerRates
}

/** Colunas somáveis de "Por corretor": total da tela e subtotal de cada equipe. */
export const BROKER_SUM_FIELDS = [
  "leadsReceived",
  "leadsAnswered",
  "leadsInSla",
  "leadsWon",
  "leadsLost",
  "leadsOpen",
  "leadsTakenBySla",
  "propertiesCaptured",
  "proposalsMade",
  "proposalsClosed",
  "salesClosed",
  "salesClosedAmount",
  "rentalsClosed",
  "rentalsClosedAmount",
] as const

type BrokerSumField = (typeof BROKER_SUM_FIELDS)[number]

export type BrokerReportTotals = Record<BrokerSumField, number> & { rates: BrokerRates }

export type BrokerReport = {
  rows: BrokerReportRow[]
  totals: BrokerReportTotals
  failed: boolean
}

/**
 * Soma de um conjunto de corretores (a imobiliária ou uma equipe). É a soma
 * das linhas JÁ agregadas pelo banco (uma por corretor), não uma varredura da
 * base — a conta pesada continua no Postgres.
 */
export function sumBrokerRows(rows: readonly BrokerReportRow[]): BrokerReportTotals {
  const totals = sumFields(rows, BROKER_SUM_FIELDS)
  return { ...totals, rates: brokerRates(totals) }
}

const EMPTY_BROKER_TOTALS = sumBrokerRows([])

export async function loadBrokerReport(scope: ReportScope): Promise<BrokerReport> {
  try {
    const supabase = await createClient()
    const { data, error } = await supabase.rpc("report_broker_performance_by_team", {
      p_organization_id: scope.organizationId,
      p_from: scope.period.from,
      p_to: scope.period.to,
      ...reportFilterArgs(scope),
    })

    if (error) {
      logFailure("o desempenho por corretor", error)
      return { rows: [], totals: EMPTY_BROKER_TOTALS, failed: true }
    }

    const rows: BrokerReportRow[] = (data ?? []).map((row) => {
      const counters = {
        leadsReceived: toNumber(row.leads_received),
        leadsAnswered: toNumber(row.leads_answered),
        leadsInSla: toNumber(row.leads_in_sla),
        leadsWon: toNumber(row.leads_won),
        leadsLost: toNumber(row.leads_lost),
        proposalsMade: toNumber(row.proposals_made),
        proposalsClosed: toNumber(row.proposals_closed),
      }

      return {
        userId: row.user_id,
        name: toText(row.full_name) ?? "Membro sem nome",
        role: isRole(row.member_role) ? row.member_role : null,
        active: row.member_active !== false,
        teamId: toText(row.team_id),
        teamName: toText(row.team_name),
        ...counters,
        leadsOpen: toNumber(row.leads_open),
        leadsTakenBySla: toNumber(row.leads_taken_by_sla),
        firstResponseMedianMinutes: toNullableNumber(row.first_response_median_minutes),
        propertiesCaptured: toNumber(row.properties_captured),
        salesClosed: toNumber(row.sales_closed),
        salesClosedAmount: toNumber(row.sales_closed_amount),
        rentalsClosed: toNumber(row.rentals_closed),
        rentalsClosedAmount: toNumber(row.rentals_closed_amount),
        rates: brokerRates(counters),
      }
    })

    return { rows, totals: sumBrokerRows(rows), failed: false }
  } catch (error) {
    logFailure("o desempenho por corretor", error)
    return { rows: [], totals: EMPTY_BROKER_TOTALS, failed: true }
  }
}

// -----------------------------------------------------------------------------
// Funil por etapa
// -----------------------------------------------------------------------------

export type FunnelStageRow = {
  stage: LeadStage
  label: string
  entered: number
  advanced: number
  lostAfter: number
  stillThere: number
  medianHours: number | null
  avgHours: number | null
  rates: StageRates
}

export type FunnelReport = {
  stages: FunnelStageRow[]
  /** Entradas somadas, para a tela saber se o funil está vazio. */
  totalEntered: number
  failed: boolean
}

export async function loadFunnelReport(scope: ReportScope): Promise<FunnelReport> {
  try {
    const supabase = await createClient()
    const { data, error } = await supabase.rpc("report_stage_funnel", {
      p_organization_id: scope.organizationId,
      p_from: scope.period.from,
      p_to: scope.period.to,
      ...reportFilterArgs(scope),
    })

    if (error) {
      logFailure("o funil por etapa", error)
      return { stages: [], totalEntered: 0, failed: true }
    }

    const byStage = new Map((data ?? []).map((row) => [row.stage, row]))
    let totalEntered = 0

    const stages = LEAD_STAGES.map((stage): FunnelStageRow => {
      const row = byStage.get(stage)
      const counters = {
        entered: toNumber(row?.entered),
        advanced: toNumber(row?.advanced),
        lostAfter: toNumber(row?.lost_after),
        stillThere: toNumber(row?.still_there),
      }

      totalEntered += counters.entered

      return {
        stage,
        label: LEAD_STAGE_LABELS[stage],
        ...counters,
        medianHours: toNullableNumber(row?.median_hours),
        avgHours: toNullableNumber(row?.avg_hours),
        rates: stageRates(counters),
      }
    })

    return { stages, totalEntered, failed: false }
  } catch (error) {
    logFailure("o funil por etapa", error)
    return { stages: [], totalEntered: 0, failed: true }
  }
}

// -----------------------------------------------------------------------------
// Origem do lead
// -----------------------------------------------------------------------------

export type SourceReportRow = {
  /** Chave só para o React; a identidade é a combinação canal + página + utm. */
  key: string
  source: LeadSource | null
  sourceLabel: string
  landingPageName: string | null
  utmSource: string | null
  utmMedium: string | null
  utmCampaign: string | null
  leads: number
  answered: number
  won: number
  lost: number
  openLeads: number
  /** Ganhos ÷ leads: a conta que separa quem traz volume de quem traz negócio. */
  winRate: number | null
  /**
   * Investimento em marketing atribuído à linha (proporcional ao período e aos
   * leads). `null` com filtro de corretor/equipe ou fora de dono e gerente.
   */
  investment: number | null
  costPerLead: number | null
  costPerWin: number | null
}

export type SourceReport = {
  rows: SourceReportRow[]
  totalLeads: number
  totalWon: number
  /** `null` quando nenhuma linha trouxe investimento (recorte ou papel). */
  totalInvestment: number | null
  totalCostPerLead: number | null
  totalCostPerWin: number | null
  failed: boolean
}

const FAILED_SOURCE_REPORT: SourceReport = {
  rows: [],
  totalLeads: 0,
  totalWon: 0,
  totalInvestment: null,
  totalCostPerLead: null,
  totalCostPerWin: null,
  failed: true,
}

function sourceLabelOf(source: string | null) {
  return source && source in LEAD_SOURCE_LABELS
    ? LEAD_SOURCE_LABELS[source as LeadSource]
    : "Origem não informada"
}

export async function loadSourceReport(scope: ReportScope): Promise<SourceReport> {
  try {
    const supabase = await createClient()
    const { data, error } = await supabase.rpc("report_lead_sources", {
      p_organization_id: scope.organizationId,
      p_from: scope.period.from,
      p_to: scope.period.to,
      p_limit: 100,
      ...reportFilterArgs(scope),
    })

    if (error) {
      logFailure("a origem dos leads", error)
      return FAILED_SOURCE_REPORT
    }

    let totalLeads = 0
    let totalWon = 0

    const rows: SourceReportRow[] = (data ?? []).map((row, index) => {
      const leads = toNumber(row.leads)
      const won = toNumber(row.won)
      const cost = leadCost({ investment: toNullableNumber(row.investment), leads, won })

      totalLeads += leads
      totalWon += won

      return {
        key: [
          row.source ?? "sem-origem",
          row.landing_page_id ?? "",
          row.utm_source ?? "",
          row.utm_medium ?? "",
          row.utm_campaign ?? "",
          index,
        ].join("|"),
        source: (toText(row.source) as LeadSource | null) ?? null,
        sourceLabel: sourceLabelOf(toText(row.source)),
        landingPageName: toText(row.landing_page_name),
        utmSource: toText(row.utm_source),
        utmMedium: toText(row.utm_medium),
        utmCampaign: toText(row.utm_campaign),
        leads,
        answered: toNumber(row.answered),
        won,
        lost: toNumber(row.lost),
        openLeads: toNumber(row.open_leads),
        winRate: rate(won, leads),
        ...cost,
      }
    })

    const totalCost = leadCost({
      investment: sumInvestment(rows),
      leads: totalLeads,
      won: totalWon,
    })

    return {
      rows,
      totalLeads,
      totalWon,
      totalInvestment: totalCost.investment,
      totalCostPerLead: totalCost.costPerLead,
      totalCostPerWin: totalCost.costPerWin,
      failed: false,
    }
  } catch (error) {
    logFailure("a origem dos leads", error)
    return FAILED_SOURCE_REPORT
  }
}

// -----------------------------------------------------------------------------
// Motivo da perda
// -----------------------------------------------------------------------------

export const NO_LOST_REASON_LABEL = "Sem motivo informado"

export type LostReasonRow = {
  reason: string | null
  label: string
  total: number
  share: number | null
}

export type LostReasonReport = {
  rows: LostReasonRow[]
  total: number
  failed: boolean
}

export async function loadLostReasonReport(scope: ReportScope): Promise<LostReasonReport> {
  try {
    const supabase = await createClient()
    const { data, error } = await supabase.rpc("report_lead_lost_reasons", {
      p_organization_id: scope.organizationId,
      p_from: scope.period.from,
      p_to: scope.period.to,
      p_limit: 20,
      ...reportFilterArgs(scope),
    })

    if (error) {
      logFailure("os motivos de perda", error)
      return { rows: [], total: 0, failed: true }
    }

    const raw = (data ?? []).map((row) => ({
      reason: toText(row.lost_reason),
      total: toNumber(row.total),
    }))

    const total = raw.reduce((sum, row) => sum + row.total, 0)

    return {
      rows: raw.map((row) => ({
        reason: row.reason,
        label: row.reason ?? NO_LOST_REASON_LABEL,
        total: row.total,
        share: rate(row.total, total),
      })),
      total,
      failed: false,
    }
  } catch (error) {
    logFailure("os motivos de perda", error)
    return { rows: [], total: 0, failed: true }
  }
}

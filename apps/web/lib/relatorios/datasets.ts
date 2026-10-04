import "server-only"

import {
  CLIENT_KIND_LABELS,
  LISTING_PURPOSE_LABELS,
  PROPERTY_STATUS_LABELS,
  PROPERTY_TYPE_LABELS,
  PROPOSAL_STATUS_LABELS,
  type ClientKind,
  type ListingPurpose,
  type PropertyStatus,
  type PropertyType,
  type ProposalStatus,
} from "@workspace/core/properties/enums"
import type { CsvValue } from "@workspace/core/reports/csv"
import { formatHours, formatMinutes, ratePercent } from "@workspace/core/reports/rates"
import { NO_TEAM_LABEL } from "@workspace/core/reports/team-subtotals"

import { ROLE_LABELS } from "@/lib/auth/roles"
import { LEAD_SOURCE_LABELS, LEAD_STAGE_LABELS } from "@/lib/leads/constants"
import type { LeadSource, LeadStage } from "@/lib/leads/db-types"
import {
  createPagedCsvStream,
  createSingleCsvStream,
  EXPORT_PAGE_SIZE,
  type ExportCursor,
} from "@/lib/relatorios/export"
import {
  loadBrokerReport,
  loadFunnelReport,
  loadLostReasonReport,
  loadSourceReport,
  NO_LOST_REASON_LABEL,
  type ReportScope,
} from "@/lib/relatorios/queries"
import { createClient } from "@/lib/supabase/server"

/**
 * O que a tela /relatorios exporta em CSV.
 *
 * Dois tipos de arquivo:
 *
 * - **relatório** (corretores, funil, origens, motivos de perda): a mesma RPC
 *   agregada que a tela usa. São poucas linhas, então saem numa consulta só —
 *   e o número da planilha é exatamente o número da tela;
 * - **base** (leads, imóveis, clientes, propostas): a lista, paginada no banco
 *   por `(created_at, id)` e transmitida página a página.
 *
 * Em todos, quem decide as LINHAS é o RLS da sessão (corretor exporta só o que
 * já enxerga) e quem decide as COLUNAS SENSÍVEIS é o papel, dentro da própria
 * RPC: CPF/CNPJ e data de nascimento do cliente e os ids de clique do lead só
 * saem para dono e gerente.
 *
 * E ninguém exporta sem registro: `startReportExport` abre a exportação em
 * `audit_events` (quem, quando, conjunto, filtros — inclusive a equipe nos
 * relatórios agregados) e diz se o papel pode exportar. As RPCs da base recusam
 * página sem esse registro e somam nele as linhas que devolvem; os relatórios
 * agregados informam a contagem por `record_report_export`. Nenhum dado
 * exportado é gravado.
 *
 * Relatório agregado que falha ao carregar NÃO sai como planilha só com o
 * cabeçalho (pareceria "nenhum dado"): a carga lança erro e o arquivo termina
 * com a linha avisando que a exportação foi interrompida.
 */

export const REPORT_DATASETS = [
  "corretores",
  "funil",
  "origens",
  "motivos-perda",
  "leads",
  "imoveis",
  "clientes",
  "propostas",
] as const

export type ReportDataset = (typeof REPORT_DATASETS)[number]

export function isReportDataset(value: unknown): value is ReportDataset {
  return typeof value === "string" && (REPORT_DATASETS as readonly string[]).includes(value)
}

export const REPORT_DATASET_LABELS: Record<ReportDataset, string> = {
  corretores: "Desempenho por corretor",
  funil: "Funil por etapa",
  origens: "Origem do lead",
  "motivos-perda": "Motivos de perda",
  leads: "Leads",
  imoveis: "Imóveis",
  clientes: "Clientes",
  propostas: "Propostas",
}

/** Prefixo do arquivo baixado (csvFileName acrescenta o período e a extensão). */
const DATASET_FILE_PREFIX: Record<ReportDataset, string> = {
  corretores: "relatorio-corretores",
  funil: "relatorio-funil",
  origens: "relatorio-origens",
  "motivos-perda": "relatorio-motivos-perda",
  leads: "base-leads",
  imoveis: "base-imoveis",
  clientes: "base-clientes",
  propostas: "base-propostas",
}

export function reportDatasetFilePrefix(dataset: ReportDataset) {
  return DATASET_FILE_PREFIX[dataset]
}

/** Relatórios agregados: aceitam o filtro de equipe e registram a equipe na exportação. */
export const AGGREGATE_REPORT_DATASETS: readonly ReportDataset[] = [
  "corretores",
  "funil",
  "origens",
  "motivos-perda",
]

export function isAggregateReportDataset(dataset: ReportDataset) {
  return AGGREGATE_REPORT_DATASETS.includes(dataset)
}

/** Erro de carga de um relatório agregado: o CSV termina com a linha de falha. */
class ReportLoadError extends Error {
  constructor(dataset: ReportDataset) {
    super(`relatório ${dataset} não carregou`)
    this.name = "ReportLoadError"
  }
}

// -----------------------------------------------------------------------------
// Registro da exportação
// -----------------------------------------------------------------------------

/** Exportação já registrada e permitida, repassada a cada página. */
export type ExportRun = {
  exportId: string
}

export type StartReportExportResult =
  { ok: true; allowed: true; run: ExportRun } | { ok: true; allowed: false } | { ok: false }

/**
 * Registra a tentativa (permitida ou não) antes de qualquer linha sair. Os
 * filtros enviados aqui são os mesmos que as páginas vão usar: o banco recusa
 * página com período, corretor, equipe ou conjunto diferente do registro.
 *
 * Relatório agregado abre por `start_report_export` (grava a equipe); a base
 * (leads, imóveis, clientes, propostas) continua em `start_data_export`, que
 * não recorta por equipe — a rota nem repassa a equipe nesse caso.
 */
export async function startReportExport(
  dataset: ReportDataset,
  scope: ReportScope
): Promise<StartReportExportResult> {
  const supabase = await createClient()
  const common = {
    p_organization_id: scope.organizationId,
    p_dataset: dataset,
    p_from: scope.period.from,
    p_to: scope.period.to,
    ...(scope.broker ? { p_user_id: scope.broker } : {}),
    ...(scope.period.preset ? { p_period_preset: scope.period.preset } : {}),
  }
  const { data, error } = isAggregateReportDataset(dataset)
    ? await supabase
        .rpc("start_report_export", {
          ...common,
          ...(scope.team ? { p_team_id: scope.team } : {}),
        })
        .maybeSingle()
    : await supabase.rpc("start_data_export", common).maybeSingle()

  if (error || !data) {
    console.error("[relatorios] falha ao registrar a exportação:", error?.code ?? "sem retorno")
    return { ok: false }
  }

  return data.allowed
    ? { ok: true, allowed: true, run: { exportId: data.export_id } }
    : { ok: true, allowed: false }
}

/** Quantidade de linhas de um relatório agregado, gravada no registro. */
async function recordReportRows(
  dataset: ReportDataset,
  scope: ReportScope,
  run: ExportRun,
  rows: number
) {
  const supabase = await createClient()
  const { error } = await supabase.rpc("record_report_export", {
    p_organization_id: scope.organizationId,
    p_export_id: run.exportId,
    p_dataset: dataset,
    p_rows: rows,
    p_from: scope.period.from,
    p_to: scope.period.to,
    ...(scope.broker ? { p_user_id: scope.broker } : {}),
    ...(scope.team ? { p_team_id: scope.team } : {}),
  })

  if (error) {
    throw new Error(`record_report_export: ${error.code ?? "erro"}`)
  }
}

// -----------------------------------------------------------------------------
// Formatação das células
// -----------------------------------------------------------------------------

const DATE_TIME = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "America/Sao_Paulo",
  dateStyle: "short",
  timeStyle: "short",
})

const DATE = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "America/Sao_Paulo",
  dateStyle: "short",
})

function cellDateTime(value: string | null | undefined): CsvValue {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : DATE_TIME.format(date)
}

/** Data pura (`date` do Postgres) é dia civil: lida em UTC, sem deslocar o fuso. */
function cellDate(value: string | null | undefined): CsvValue {
  if (!value) return null
  const date = new Date(`${value}T00:00:00Z`)
  return Number.isNaN(date.getTime()) ? null : DATE.format(date)
}

function cellNumber(value: unknown): CsvValue {
  const parsed = typeof value === "number" ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function labelOf<T extends string>(
  labels: Record<T, string>,
  value: string | null | undefined
): CsvValue {
  if (!value) return null
  return value in labels ? labels[value as T] : value
}

// -----------------------------------------------------------------------------
// Definição de cada exportação
// -----------------------------------------------------------------------------

export type ReportCsvDataset = {
  columns: readonly string[]
  stream(scope: ReportScope, run: ExportRun): ReadableStream<Uint8Array>
}

const brokersDataset: ReportCsvDataset = {
  columns: [
    "Corretor",
    "Equipe",
    "Papel",
    "Ativo",
    "Leads recebidos",
    "Leads atendidos",
    "Atendidos no prazo",
    "Atendimento (%)",
    "SLA cumprido (%)",
    "1º contato (mediana)",
    "Ganhos",
    "Perdidos",
    "Em aberto",
    "Fechamento (%)",
    "Tirados por estouro de prazo",
    "Imóveis captados",
    "Propostas feitas",
    "Propostas fechadas",
    "Vendas fechadas",
    "Valor das vendas (R$)",
    "Locações fechadas",
    "Valor das locações (R$)",
  ],
  stream(scope, run) {
    return createSingleCsvStream(this.columns, async () => {
      const report = await loadBrokerReport(scope)

      if (report.failed) throw new ReportLoadError("corretores")

      const rows = report.rows.map((row) => [
        row.name,
        row.teamId ? (row.teamName ?? "Equipe sem nome") : NO_TEAM_LABEL,
        row.role ? ROLE_LABELS[row.role] : null,
        row.active,
        row.leadsReceived,
        row.leadsAnswered,
        row.leadsInSla,
        ratePercent(row.rates.answerRate),
        ratePercent(row.rates.slaRate),
        formatMinutes(row.firstResponseMedianMinutes),
        row.leadsWon,
        row.leadsLost,
        row.leadsOpen,
        ratePercent(row.rates.winRate),
        row.leadsTakenBySla,
        row.propertiesCaptured,
        row.proposalsMade,
        row.proposalsClosed,
        row.salesClosed,
        row.salesClosedAmount,
        row.rentalsClosed,
        row.rentalsClosedAmount,
      ])

      await recordReportRows("corretores", scope, run, rows.length)
      return rows
    })
  },
}

const funnelDataset: ReportCsvDataset = {
  columns: [
    "Etapa",
    "Entradas",
    "Avançaram",
    "Conversão para a etapa seguinte (%)",
    "Foram perdidos",
    "Perda (%)",
    "Ainda nesta etapa",
    "Tempo na etapa (mediana)",
    "Tempo na etapa (média)",
    "Mediana em horas",
    "Média em horas",
  ],
  stream(scope, run) {
    return createSingleCsvStream(this.columns, async () => {
      const report = await loadFunnelReport(scope)

      if (report.failed) throw new ReportLoadError("funil")

      const rows = report.stages.map((stage) => [
        stage.label,
        stage.entered,
        stage.advanced,
        ratePercent(stage.rates.advanceRate),
        stage.lostAfter,
        ratePercent(stage.rates.lossRate),
        stage.stillThere,
        formatHours(stage.medianHours),
        formatHours(stage.avgHours),
        stage.medianHours,
        stage.avgHours,
      ])

      await recordReportRows("funil", scope, run, rows.length)
      return rows
    })
  },
}

const sourcesDataset: ReportCsvDataset = {
  columns: [
    "Canal",
    "Landing page",
    "utm_source",
    "utm_medium",
    "utm_campaign",
    "Leads",
    "Atendidos",
    "Ganhos",
    "Perdidos",
    "Em aberto",
    "Conversão (%)",
    "Investimento (R$)",
    "Custo por lead (R$)",
    "Custo por ganho (R$)",
  ],
  stream(scope, run) {
    return createSingleCsvStream(this.columns, async () => {
      const report = await loadSourceReport(scope)

      if (report.failed) throw new ReportLoadError("origens")

      // Investimento vazio = recorte por corretor/equipe ou papel sem acesso ao
      // gasto (a RPC devolve null); nunca é "R$ 0".
      const rows = report.rows.map((row) => [
        row.sourceLabel,
        row.landingPageName,
        row.utmSource,
        row.utmMedium,
        row.utmCampaign,
        row.leads,
        row.answered,
        row.won,
        row.lost,
        row.openLeads,
        ratePercent(row.winRate),
        row.investment,
        row.costPerLead,
        row.costPerWin,
      ])

      await recordReportRows("origens", scope, run, rows.length)
      return rows
    })
  },
}

const lostReasonsDataset: ReportCsvDataset = {
  columns: ["Motivo da perda", "Leads perdidos", "Fatia das perdas (%)"],
  stream(scope, run) {
    return createSingleCsvStream(this.columns, async () => {
      const report = await loadLostReasonReport(scope)

      if (report.failed) throw new ReportLoadError("motivos-perda")

      const rows = report.rows.map((row) => [
        row.reason ?? NO_LOST_REASON_LABEL,
        row.total,
        ratePercent(row.share),
      ])

      await recordReportRows("motivos-perda", scope, run, rows.length)
      return rows
    })
  },
}

/**
 * Parâmetros comuns das RPCs de exportação paginada. Período e corretor são os
 * mesmos de `startReportExport`: o banco confere com o registro.
 */
function pageArgs(scope: ReportScope, run: ExportRun, cursor: ExportCursor | null) {
  return {
    p_organization_id: scope.organizationId,
    p_export_id: run.exportId,
    p_from: scope.period.from,
    p_to: scope.period.to,
    p_limit: EXPORT_PAGE_SIZE,
    ...(scope.broker ? { p_user_id: scope.broker } : {}),
    ...(cursor ? { p_after_created_at: cursor.createdAt, p_after_id: cursor.id } : {}),
  }
}

/** Onde continuar: a última linha da página, ou `null` quando ela veio curta. */
function nextCursor(rows: readonly { created_at: string; id: string }[]): ExportCursor | null {
  const last = rows.length === EXPORT_PAGE_SIZE ? rows[rows.length - 1] : undefined
  return last ? { createdAt: last.created_at, id: last.id } : null
}

const leadsDataset: ReportCsvDataset = {
  columns: [
    "Criado em",
    "Nome",
    "E-mail",
    "Telefone",
    "Etapa",
    "Canal",
    "Interesse",
    "Landing page",
    "utm_source",
    "utm_medium",
    "utm_campaign",
    "Responsável",
    "Recebido em",
    "1º contato em",
    "Motivo da perda",
    "Ids de clique",
  ],
  stream(scope, run) {
    return createPagedCsvStream(this.columns, async (cursor) => {
      const supabase = await createClient()
      const { data, error } = await supabase.rpc("export_leads_rows", pageArgs(scope, run, cursor))

      if (error) {
        throw new Error(`export_leads_rows: ${error.code ?? "erro"}`)
      }

      const rows = data ?? []

      return {
        rows: rows.map((row) => [
          cellDateTime(row.created_at),
          row.name,
          row.email,
          row.phone,
          labelOf<LeadStage>(LEAD_STAGE_LABELS, row.stage),
          labelOf<LeadSource>(LEAD_SOURCE_LABELS, row.source),
          row.interest,
          row.landing_page_name,
          row.utm_source,
          row.utm_medium,
          row.utm_campaign,
          row.assigned_to_name,
          cellDateTime(row.assigned_at),
          cellDateTime(row.first_contact_at),
          row.lost_reason,
          row.tracking_ids,
        ]),
        cursor: nextCursor(rows),
      }
    })
  },
}

const propertiesDataset: ReportCsvDataset = {
  columns: [
    "Criado em",
    "Código",
    "Título",
    "Tipo",
    "Finalidade",
    "Situação",
    "Venda (R$)",
    "Aluguel (R$)",
    "Condomínio (R$)",
    "Bairro",
    "Cidade",
    "UF",
    "Quartos",
    "Vagas",
    "Área útil (m²)",
    "Captador",
    "Corretor",
    "ImobScore",
    "Nos portais",
  ],
  stream(scope, run) {
    return createPagedCsvStream(this.columns, async (cursor) => {
      const supabase = await createClient()
      const { data, error } = await supabase.rpc(
        "export_properties_rows",
        pageArgs(scope, run, cursor)
      )

      if (error) {
        throw new Error(`export_properties_rows: ${error.code ?? "erro"}`)
      }

      const rows = data ?? []

      return {
        rows: rows.map((row) => [
          cellDateTime(row.created_at),
          row.code,
          row.title,
          labelOf<PropertyType>(PROPERTY_TYPE_LABELS, row.type),
          labelOf<ListingPurpose>(LISTING_PURPOSE_LABELS, row.purpose),
          labelOf<PropertyStatus>(PROPERTY_STATUS_LABELS, row.status),
          cellNumber(row.sale_price),
          cellNumber(row.rent_price),
          cellNumber(row.condo_fee),
          row.neighborhood,
          row.city,
          row.state,
          cellNumber(row.bedrooms),
          cellNumber(row.parking_spaces),
          cellNumber(row.living_area),
          row.captured_by_name,
          row.broker_name,
          cellNumber(row.imob_score),
          row.published_to_portals === true,
        ]),
        cursor: nextCursor(rows),
      }
    })
  },
}

const clientsDataset: ReportCsvDataset = {
  columns: [
    "Criado em",
    "Nome",
    "Tipo",
    "CPF/CNPJ",
    "Nascimento",
    "E-mail",
    "Telefone",
    "WhatsApp",
    "Bairro",
    "Cidade",
    "UF",
    "Origem",
    "Etiquetas",
    "Responsável",
    "Consentimento LGPD em",
  ],
  stream(scope, run) {
    return createPagedCsvStream(this.columns, async (cursor) => {
      const supabase = await createClient()
      const { data, error } = await supabase.rpc(
        "export_clients_rows",
        pageArgs(scope, run, cursor)
      )

      if (error) {
        throw new Error(`export_clients_rows: ${error.code ?? "erro"}`)
      }

      const rows = data ?? []

      return {
        rows: rows.map((row) => [
          cellDateTime(row.created_at),
          row.name,
          labelOf<ClientKind>(CLIENT_KIND_LABELS, row.kind),
          row.document,
          cellDate(row.birth_date),
          row.email,
          row.phone,
          row.whatsapp,
          row.neighborhood,
          row.city,
          row.state,
          row.source,
          Array.isArray(row.tags) ? row.tags.join(", ") : null,
          row.assigned_to_name,
          cellDateTime(row.lgpd_consent_at),
        ]),
        cursor: nextCursor(rows),
      }
    })
  },
}

const proposalsDataset: ReportCsvDataset = {
  columns: [
    "Criada em",
    "Imóvel (código)",
    "Imóvel",
    "Cliente",
    "Corretor",
    "Finalidade",
    "Valor (R$)",
    "Situação",
    "Válida até",
    "Decidida em",
  ],
  stream(scope, run) {
    return createPagedCsvStream(this.columns, async (cursor) => {
      const supabase = await createClient()
      const { data, error } = await supabase.rpc(
        "export_proposals_rows",
        pageArgs(scope, run, cursor)
      )

      if (error) {
        throw new Error(`export_proposals_rows: ${error.code ?? "erro"}`)
      }

      const rows = data ?? []

      return {
        rows: rows.map((row) => [
          cellDateTime(row.created_at),
          row.property_code,
          row.property_title,
          row.client_name,
          row.broker_name,
          labelOf<ListingPurpose>(LISTING_PURPOSE_LABELS, row.purpose),
          cellNumber(row.amount),
          labelOf<ProposalStatus>(PROPOSAL_STATUS_LABELS, row.status),
          cellDate(row.valid_until),
          cellDateTime(row.decided_at),
        ]),
        cursor: nextCursor(rows),
      }
    })
  },
}

export const REPORT_CSV_DATASETS: Record<ReportDataset, ReportCsvDataset> = {
  corretores: brokersDataset,
  funil: funnelDataset,
  origens: sourcesDataset,
  "motivos-perda": lostReasonsDataset,
  leads: leadsDataset,
  imoveis: propertiesDataset,
  clientes: clientsDataset,
  propostas: proposalsDataset,
}

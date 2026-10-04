import type { NextRequest } from "next/server"

import { csvFileName } from "@workspace/core/reports/csv"
import { resolveReportPeriod } from "@workspace/core/reports/period"

import { requireMembership } from "@/lib/auth/session"
import { getExportRoles } from "@/lib/configuracoes/export-audit"
import { exportDeniedMessage } from "@/lib/configuracoes/export-permissions"
import {
  isAggregateReportDataset,
  isReportDataset,
  REPORT_CSV_DATASETS,
  reportDatasetFilePrefix,
  startReportExport,
} from "@/lib/relatorios/datasets"
import { csvResponse } from "@/lib/relatorios/export"
import type { ReportScope } from "@/lib/relatorios/queries"
import { parseReportFilterParams } from "@/lib/relatorios/url"

/**
 * Download em CSV dos relatórios e da base, em `/api/relatorios/<recurso>`.
 *
 * `recurso` é um dos nomes de `REPORT_DATASETS`; qualquer outra coisa é 404
 * (nada de mensagem dizendo o que existe). O período, o corretor e a equipe vêm
 * da URL nos mesmos parâmetros da tela, então o arquivo bate com o que estava
 * sendo lido quando o botão foi clicado.
 *
 * Antes de qualquer linha, a exportação é registrada em `audit_events` (quem,
 * quando, conjunto e filtros) e o banco diz se o papel exporta nesta
 * imobiliária (padrão: dono e gerente; o dono muda em Configurações > Papéis e
 * permissões). Sem permissão: 403 com o motivo, e a recusa fica registrada.
 * Com permissão, as RPCs da base só entregam página com esse registro e somam
 * nele as linhas — chamar a RPC direto não pula nem a permissão nem a trilha.
 *
 * Quem decide o conteúdo continua sendo o banco: as RPCs são `security invoker`
 * (as linhas saem do RLS da sessão) e o recorte por papel acontece dentro delas
 * — um corretor liberado baixa só o que já enxerga, e sem as colunas sensíveis.
 */

const PLAIN_HEADERS = {
  "Content-Type": "text/plain; charset=utf-8",
  "Cache-Control": "no-store",
  "X-Robots-Tag": "noindex",
}

const NOT_FOUND_HEADERS = {
  "Cache-Control": "no-store",
  "X-Robots-Tag": "noindex",
}

const UNAVAILABLE_MESSAGE =
  "Não foi possível registrar a exportação agora, e nenhum arquivo sai sem registro. Tente de novo em instantes."

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ recurso: string }> }
) {
  const [{ membership }, { recurso }] = await Promise.all([requireMembership(), params])

  if (!isReportDataset(recurso)) {
    return new Response(null, { status: 404, headers: NOT_FOUND_HEADERS })
  }

  const search = request.nextUrl.searchParams
  const period = resolveReportPeriod({
    preset: search.get("periodo"),
    from: search.get("de"),
    to: search.get("ate"),
  })

  // Corretor ou equipe inválidos viram "toda a equipe"; quem não pode ver os
  // colegas é recortado pela RPC de qualquer jeito. A equipe só vale para os
  // relatórios agregados: a base não recorta por equipe.
  const filters = parseReportFilterParams(search)

  const scope: ReportScope = {
    organizationId: membership.organizationId,
    period,
    broker: filters.broker,
    team: isAggregateReportDataset(recurso) ? filters.team : null,
  }

  const started = await startReportExport(recurso, scope)

  if (!started.ok) {
    return new Response(UNAVAILABLE_MESSAGE, { status: 503, headers: PLAIN_HEADERS })
  }

  if (!started.allowed) {
    const exportRoles = await getExportRoles(membership.organizationId)
    return new Response(exportDeniedMessage(exportRoles), { status: 403, headers: PLAIN_HEADERS })
  }

  const body = REPORT_CSV_DATASETS[recurso].stream(scope, started.run)

  return csvResponse(csvFileName(reportDatasetFilePrefix(recurso), period), body)
}

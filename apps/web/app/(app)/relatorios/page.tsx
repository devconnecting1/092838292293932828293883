import { Suspense } from "react"
import type { Metadata } from "next"
import Link from "next/link"
import { InfoIcon } from "lucide-react"

import {
  currentMonthKey,
  formatMonthLabel,
  goalMonthOptions,
} from "@workspace/core/reports/sales-goals"
import { Alert, AlertDescription, AlertTitle } from "@workspace/ui/components/alert"
import { Button } from "@workspace/ui/components/button"

import { PageHeading } from "@/components/crm/page-placeholder"
import { ExportLinks } from "@/components/relatorios/export-links"
import { ForecastSection } from "@/components/relatorios/forecast-section"
import { GoalsSection } from "@/components/relatorios/goals-section"
import { ReportFilters } from "@/components/relatorios/report-filters"
import {
  BrokersSection,
  FunnelSection,
  LostReasonsSection,
  SourcesSection,
} from "@/components/relatorios/report-sections"
import { ReportTabSkeleton } from "@/components/relatorios/report-skeletons"
import { ReportTabs } from "@/components/relatorios/report-tabs"
import { PageShell } from "@/components/shared/page-shell"
import { ROLE_PERMISSIONS_SETTINGS_PATH } from "@/components/shared/settings-config"
import { ROLE_LABELS, type Role } from "@/lib/auth/roles"
import { requireMembership } from "@/lib/auth/session"
import { getOrganizationMembers } from "@/lib/clientes/members"
import { getExportRoles } from "@/lib/configuracoes/export-audit"
import { canExportData } from "@/lib/configuracoes/export-permissions"
import type { ReportDataset } from "@/lib/relatorios/datasets"
import {
  loadForecastProposals,
  loadForecastReport,
  loadStageProbabilities,
} from "@/lib/relatorios/forecast"
import { loadGoalReport } from "@/lib/relatorios/goals"
import {
  canEditGoals,
  canManageMarketingInvestments,
  reportAccess,
  reportScopeNotice,
  reportScopeTitle,
  type ReportAccess,
} from "@/lib/relatorios/permissions"
import {
  loadBrokerReport,
  loadFunnelReport,
  loadLostReasonReport,
  loadSourceReport,
  type ReportScope,
} from "@/lib/relatorios/queries"
import { ledTeams, loadReportTeams } from "@/lib/relatorios/teams"
import { parseReportSearchParams, tabUsesPeriod, type ReportTab } from "@/lib/relatorios/url"

export const metadata: Metadata = {
  title: "Relatórios",
}

/** A base sai sempre do mesmo período e corretor que estão na tela. */
const BASE_DATASETS: readonly ReportDataset[] = ["leads", "imoveis", "clientes", "propostas"]

/** CSV do relatório aberto (Metas e Previsão ainda não exportam). */
const TAB_DATASETS: Record<ReportTab, readonly ReportDataset[]> = {
  corretores: ["corretores", "motivos-perda"],
  funil: ["funil"],
  origens: ["origens"],
  metas: [],
  previsao: [],
}

type SearchParams = Record<string, string | string[] | undefined>

export default async function RelatoriosPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>
}) {
  const [{ user, membership }, params] = await Promise.all([requireMembership(), searchParams])

  const now = new Date()
  const view = parseReportSearchParams(params, now)
  const role = membership.role
  const organizationId = membership.organizationId

  // Equipes são leitura de todo membro: é assim que a tela descobre se quem
  // olha lidera alguma. O recorte dos números continua no banco.
  const reportTeams = await loadReportTeams(organizationId)
  const led = ledTeams(reportTeams.teams, user.id)
  const access = reportAccess(
    role,
    led.map((team) => team.id)
  )

  // `getExportRoles` é memorizado por requisição: os links de exportação reusam a leitura.
  const [allMembers, exportRoles] = await Promise.all([
    access === "self" ? [] : getOrganizationMembers(organizationId),
    getExportRoles(organizationId),
  ])

  // O líder escolhe só dentro das equipes que lidera (e a si mesmo).
  const leaderScope =
    access === "leader" ? new Set([user.id, ...led.flatMap((team) => team.memberIds)]) : null
  const filterTeams = access === "organization" ? reportTeams.teams : access === "leader" ? led : []
  const filterMembers = leaderScope
    ? allMembers.filter((member) => leaderScope.has(member.id))
    : allMembers

  // Quem vê só o próprio número não escolhe nada: o banco ignoraria o parâmetro,
  // e a tela não deve sugerir um recorte que não existe.
  const team =
    access === "organization"
      ? view.team
      : access === "leader" && view.team && led.some((item) => item.id === view.team)
        ? view.team
        : null
  const broker =
    access === "organization"
      ? view.broker
      : leaderScope && view.broker && leaderScope.has(view.broker)
        ? view.broker
        : null

  const scope: ReportScope = { organizationId, period: view.period, broker, team }

  const canExport = canExportData(role, exportRoles)
  const selfName =
    user.fullName?.trim() ||
    allMembers.find((member) => member.id === user.id)?.name ||
    user.email ||
    ROLE_LABELS[role]

  const periodLabel = view.period.label
  const usesPeriod = tabUsesPeriod(view.tab)
  const description =
    view.tab === "metas"
      ? `Metas e realizado de ${formatMonthLabel(view.month)}, por equipe e por corretor.`
      : view.tab === "previsao"
        ? "Quanto a equipe deve fechar no mês, com venda e locação separadas."
        : `Desempenho da equipe, funil e origem dos leads em ${periodLabel}.`

  return (
    <PageShell
      header={
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <PageHeading title="Relatórios" description={description} />
          <ExportLinks
            datasets={TAB_DATASETS[view.tab]}
            period={view.period}
            broker={broker}
            team={team}
            emphasizeFirst
          />
        </div>
      }
    >
      <Alert>
        <InfoIcon />
        <AlertTitle>{reportScopeTitle(access, ROLE_LABELS[role])}</AlertTitle>
        <AlertDescription>
          {reportScopeNotice(
            access,
            selfName,
            led.map((item) => item.name)
          )}
        </AlertDescription>
      </Alert>

      {/* O `key` é o período: mudou o período, o filtro remonta e os campos
          nascem já sincronizados com a URL (nada de efeito copiando prop). */}
      <ReportFilters
        key={`${view.period.preset ?? "personalizado"}-${view.period.fromDay}-${view.period.toDay}`}
        period={view.period}
        broker={broker}
        team={team}
        month={view.month}
        monthOptions={goalMonthOptions(view.month, now)}
        isCurrentMonth={view.month === currentMonthKey(now)}
        tab={view.tab}
        access={access}
        teams={filterTeams}
        members={filterMembers}
        selfName={selfName}
      />

      <ReportTabs
        tab={view.tab}
        period={view.period}
        broker={broker}
        team={team}
        month={view.month}
      />

      {/* Uma chave por recorte: trocar filtro ou aba mostra o esqueleto enquanto
          o banco soma, em vez de deixar o número antigo na tela. */}
      <Suspense
        key={[view.tab, view.period.from, view.period.to, team, broker, view.month].join("|")}
        fallback={<ReportTabSkeleton tab={view.tab} />}
      >
        <ReportTabContent
          tab={view.tab}
          scope={scope}
          month={view.month}
          access={access}
          role={role}
          periodLabel={periodLabel}
          now={now}
        />
      </Suspense>

      {usesPeriod ? (
        <section className="flex flex-col gap-2 border-t pt-6">
          {canExport ? (
            <>
              <h2 className="text-sm font-medium">Exportar a base do período</h2>
              <p className="text-sm text-muted-foreground">
                Arquivo CSV com BOM UTF-8 e separador ponto e vírgula, que o Excel brasileiro abre
                sem quebrar acento. Sai com as mesmas linhas que você já enxerga no sistema
                {access === "organization"
                  ? ""
                  : " — e sem CPF/CNPJ nem data de nascimento, que só o dono e o gerente exportam"}
                {team ? ". A base usa o período e o corretor, não o filtro de equipe." : "."}
              </p>
            </>
          ) : (
            // Sem promessa de download: o aviso abaixo diz quem exporta hoje e quem libera.
            <h2 className="text-sm font-medium">Exportação da base</h2>
          )}
          <ExportLinks datasets={BASE_DATASETS} period={view.period} broker={broker} />
          {canExport ? null : (
            <Button
              variant="link"
              size="sm"
              className="self-start px-0"
              render={<Link href={ROLE_PERMISSIONS_SETTINGS_PATH} />}
              nativeButton={false}
            >
              Ver o que cada papel pode fazer
            </Button>
          )}
        </section>
      ) : null}
    </PageShell>
  )
}

/** Conteúdo da aba aberta. Só ela consulta o banco. */
async function ReportTabContent({
  tab,
  scope,
  month,
  access,
  role,
  periodLabel,
  now,
}: {
  tab: ReportTab
  scope: ReportScope
  month: string
  access: ReportAccess
  role: Role
  periodLabel: string
  now: Date
}) {
  switch (tab) {
    case "funil":
      return <FunnelSection report={await loadFunnelReport(scope)} periodLabel={periodLabel} />

    case "origens":
      return (
        <SourcesSection
          report={await loadSourceReport(scope)}
          periodLabel={periodLabel}
          access={access}
          filtered={Boolean(scope.team || scope.broker)}
          canManageInvestments={canManageMarketingInvestments(role)}
        />
      )

    case "metas": {
      const report = await loadGoalReport({
        organizationId: scope.organizationId,
        month,
        broker: scope.broker,
        team: scope.team,
      })

      return <GoalsSection report={report} month={month} canEdit={canEditGoals(role)} now={now} />
    }

    case "previsao": {
      const forecastScope = {
        organizationId: scope.organizationId,
        broker: scope.broker,
        team: scope.team,
      }
      const [report, proposals, probabilities] = await Promise.all([
        loadForecastReport(forecastScope),
        loadForecastProposals(forecastScope),
        loadStageProbabilities(scope.organizationId),
      ])

      return (
        <ForecastSection
          report={report}
          proposals={proposals}
          probabilities={probabilities}
          access={access}
          canAdjustProbabilities={role === "owner"}
          now={now}
        />
      )
    }

    default: {
      const [brokerReport, lostReasons] = await Promise.all([
        loadBrokerReport(scope),
        loadLostReasonReport(scope),
      ])

      return (
        <div className="flex flex-col gap-6">
          <BrokersSection report={brokerReport} periodLabel={periodLabel} access={access} />
          <LostReasonsSection report={lostReasons} periodLabel={periodLabel} />
        </div>
      )
    }
  }
}

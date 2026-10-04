import type { Metadata } from "next"
import Link from "next/link"
import { ChevronLeftIcon, ChevronRightIcon, CoinsIcon, InfoIcon } from "lucide-react"

import {
  formatMonthLabel,
  isMonthKey,
  listMonthKeys,
  shiftMonthKey,
  summarizeInvestmentsBySource,
} from "@workspace/core/reports/marketing-investments"
import { Alert, AlertDescription, AlertTitle } from "@workspace/ui/components/alert"
import { Button } from "@workspace/ui/components/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@workspace/ui/components/empty"

import { PageHeading } from "@/components/crm/page-placeholder"
import { CostPerLeadExplainer } from "@/components/marketing/investimentos/cost-per-lead-explainer"
import { InvestmentFormDialog } from "@/components/marketing/investimentos/investment-form-dialog"
import { InvestmentsList } from "@/components/marketing/investimentos/investments-list"
import { MonthTotalsCard } from "@/components/marketing/investimentos/month-totals-card"
import { PageShell } from "@/components/shared/page-shell"
import { requireRole } from "@/lib/auth/session"
import { todayInSaoPaulo } from "@/lib/configuracoes/dates"
import {
  canEditMarketingInvestments,
  INVESTMENT_MONTHS_AHEAD,
  INVESTMENT_MONTHS_BACK,
  MARKETING_INVESTMENT_VIEWER_ROLES,
  MARKETING_INVESTMENTS_PATH,
} from "@/lib/marketing/investimentos/constants"
import {
  getRecentMonthTotals,
  listCampaignSuggestions,
  listMonthInvestments,
} from "@/lib/marketing/investimentos/queries"

export const metadata: Metadata = {
  title: "Investimento em marketing",
}

type SearchParams = Record<string, string | string[] | undefined>

const REPORTS_SOURCES_HREF = "/relatorios?aba=origens"

function monthHref(month: string) {
  return `${MARKETING_INVESTMENTS_PATH}?mes=${month}`
}

export default async function MarketingInvestmentsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>
}) {
  const [{ membership }, params] = await Promise.all([
    requireRole(MARKETING_INVESTMENT_VIEWER_ROLES),
    searchParams,
  ])
  const organizationId = membership.organizationId
  const canEdit = canEditMarketingInvestments(membership.role)

  const currentMonth = todayInSaoPaulo().slice(0, 7)
  const rawMonth = Array.isArray(params.mes) ? params.mes[0] : params.mes
  const month = isMonthKey(rawMonth) ? rawMonth : currentMonth
  const previousMonth = shiftMonthKey(month, -1)
  const nextMonth = shiftMonthKey(month, 1)

  const [investments, recentTotals, campaignSuggestions] = await Promise.all([
    listMonthInvestments(organizationId, month),
    getRecentMonthTotals(organizationId, month, 6),
    canEdit ? listCampaignSuggestions(organizationId) : Promise.resolve([]),
  ])

  const summary = summarizeInvestmentsBySource(investments)
  const monthOptions = listMonthKeys(currentMonth, INVESTMENT_MONTHS_BACK, INVESTMENT_MONTHS_AHEAD)
  const formMonthOptions = monthOptions.includes(month) ? monthOptions : [month, ...monthOptions]

  const heading = (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
      <PageHeading
        title="Investimento em marketing"
        description="Quanto foi gasto por mês em cada canal e campanha. É a base do custo por lead dos relatórios."
      />
      {canEdit ? (
        <InvestmentFormDialog
          mode="create"
          defaultMonth={month}
          monthOptions={formMonthOptions}
          campaignSuggestions={campaignSuggestions}
        />
      ) : null}
    </div>
  )

  return (
    <PageShell header={heading}>
      {!canEdit ? (
        <Alert>
          <InfoIcon />
          <AlertTitle>Somente leitura</AlertTitle>
          <AlertDescription>
            O financeiro acompanha os valores; só o dono e o gerente lançam, editam e excluem.
          </AlertDescription>
        </Alert>
      ) : null}

      <nav
        aria-label="Mês"
        className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-2"
      >
        {previousMonth ? (
          <Button
            variant="ghost"
            size="sm"
            render={<Link href={monthHref(previousMonth)} />}
            nativeButton={false}
          >
            <ChevronLeftIcon data-icon="inline-start" />
            <span className="sr-only sm:not-sr-only">{formatMonthLabel(previousMonth)}</span>
          </Button>
        ) : (
          <span />
        )}
        <div className="flex flex-col items-center text-center">
          <span className="text-sm font-medium first-letter:uppercase">
            {formatMonthLabel(month)}
          </span>
          {month !== currentMonth ? (
            <Link
              href={monthHref(currentMonth)}
              className="text-xs text-muted-foreground underline underline-offset-4"
            >
              Ir para o mês atual
            </Link>
          ) : (
            <span className="text-xs text-muted-foreground">Mês atual</span>
          )}
        </div>
        {nextMonth ? (
          <Button
            variant="ghost"
            size="sm"
            render={<Link href={monthHref(nextMonth)} />}
            nativeButton={false}
          >
            <span className="sr-only sm:not-sr-only">{formatMonthLabel(nextMonth)}</span>
            <ChevronRightIcon data-icon="inline-end" />
          </Button>
        ) : (
          <span />
        )}
      </nav>

      {investments.length === 0 ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <CoinsIcon />
            </EmptyMedia>
            <EmptyTitle>Nada lançado em {formatMonthLabel(month)}</EmptyTitle>
            <EmptyDescription>
              {canEdit
                ? "Lance quanto foi gasto em portais, redes sociais, site e outros canais para ver o custo por lead nos relatórios."
                : "Quando o dono ou o gerente lançar os valores deste mês, eles aparecem aqui."}
            </EmptyDescription>
          </EmptyHeader>
          {canEdit ? (
            <EmptyContent>
              <InvestmentFormDialog
                mode="create"
                defaultMonth={month}
                monthOptions={formMonthOptions}
                campaignSuggestions={campaignSuggestions}
              />
            </EmptyContent>
          ) : null}
        </Empty>
      ) : (
        <div className="grid gap-4 @min-[64rem]/page:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <Card>
            <CardHeader>
              <CardTitle>Lançamentos</CardTitle>
              <CardDescription>
                {investments.length === 1
                  ? "1 lançamento neste mês."
                  : `${investments.length} lançamentos neste mês.`}{" "}
                Cada combinação de canal e campanha aparece uma vez.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <InvestmentsList
                investments={investments}
                canEdit={canEdit}
                monthOptions={formMonthOptions}
                campaignSuggestions={campaignSuggestions}
              />
            </CardContent>
          </Card>

          <MonthTotalsCard
            month={month}
            totalCents={summary.totalCents}
            sources={summary.sources}
            previous={recentTotals}
          />
        </div>
      )}

      <CostPerLeadExplainer reportsHref={REPORTS_SOURCES_HREF} />
    </PageShell>
  )
}

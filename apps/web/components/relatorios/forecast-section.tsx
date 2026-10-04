import Link from "next/link"
import { CalendarClockIcon, CalendarXIcon, TrendingUpIcon } from "lucide-react"

import { LISTING_PURPOSE_LABELS, PROPOSAL_STATUS_LABELS } from "@workspace/core/properties/enums"
import { todayInBrasilia } from "@workspace/core/reports/period"
import {
  FORECAST_BUCKET_LABELS,
  hasForecastData,
  sumBrokerForecasts,
  type ForecastBucket,
  type ForecastPurpose,
  type ForecastSummary,
  type PurposeForecast,
} from "@workspace/core/reports/sales-forecast"
import { countTeamGroups, groupRowsByTeam } from "@workspace/core/reports/team-subtotals"
import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
} from "@workspace/ui/components/item"
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@workspace/ui/components/table"

import { ExpectedCloseDateForm } from "@/components/relatorios/expected-close-date-form"
import { count, LoadError, ReportEmpty } from "@/components/relatorios/report-sections"
import { formatDateOnly } from "@/lib/configuracoes/dates"
import { formatCurrency } from "@/lib/format"
import type {
  ForecastProposal,
  ForecastProposalList,
  ForecastReport,
  StageProbability,
} from "@/lib/relatorios/forecast"
import type { ReportAccess } from "@/lib/relatorios/permissions"

/** Tela do dono para ajustar a probabilidade de fechamento por etapa. */
export const STAGE_PROBABILITIES_PATH = "/configuracoes/previsao"

const PURPOSE_TITLES: Record<ForecastPurpose, string> = {
  sale: "Venda",
  rent: "Locação",
}

/** Faixas listadas abaixo do número principal, na ordem de leitura. */
const DETAIL_BUCKETS: readonly ForecastBucket[] = ["overdue", "next_month", "later", "no_date"]

function PurposeCard({ purpose, data }: { purpose: ForecastPurpose; data: PurposeForecast }) {
  return (
    <Card>
      <CardHeader>
        <CardDescription>{PURPOSE_TITLES[purpose]} · previsão do mês</CardDescription>
        <CardTitle className="text-2xl tabular-nums">
          {formatCurrency(data.monthForecast)}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <dl className="flex flex-col gap-2 text-sm">
          <div className="flex items-baseline justify-between gap-3">
            <dt>Comprometido (aceitas no mês)</dt>
            <dd className="text-end tabular-nums">
              {formatCurrency(data.committed.amount)}
              <span className="text-muted-foreground"> · {count(data.committed.proposals)}</span>
            </dd>
          </div>
          <div className="flex items-baseline justify-between gap-3">
            <dt>Previstas para este mês (ponderado)</dt>
            <dd className="text-end tabular-nums">
              {formatCurrency(data.current_month.weightedAmount)}
              <span className="text-muted-foreground">
                {" "}
                · {count(data.current_month.proposals)}
              </span>
            </dd>
          </div>
          <div className="flex items-baseline justify-between gap-3 text-muted-foreground">
            <dt>Valor cheio das previstas para este mês</dt>
            <dd className="text-end tabular-nums">{formatCurrency(data.current_month.amount)}</dd>
          </div>
          {DETAIL_BUCKETS.map((bucket) => (
            <div
              key={bucket}
              className="flex items-baseline justify-between gap-3 border-t pt-2 text-muted-foreground"
            >
              <dt>{FORECAST_BUCKET_LABELS[bucket]}</dt>
              <dd className="text-end tabular-nums">
                {count(data[bucket].proposals)}
                {data[bucket].proposals > 0 ? ` · ${formatCurrency(data[bucket].amount)}` : ""}
              </dd>
            </div>
          ))}
        </dl>
      </CardContent>
    </Card>
  )
}

function ForecastNumberCells({ summary }: { summary: ForecastSummary }) {
  return (
    <>
      <TableCell className="text-end tabular-nums">
        {formatCurrency(summary.sale.committed.amount)}
      </TableCell>
      <TableCell className="text-end tabular-nums">
        {formatCurrency(summary.sale.current_month.weightedAmount)}
      </TableCell>
      <TableCell className="text-end font-medium tabular-nums">
        {formatCurrency(summary.sale.monthForecast)}
      </TableCell>
      <TableCell className="text-end tabular-nums">
        {formatCurrency(summary.rent.committed.amount)}
      </TableCell>
      <TableCell className="text-end tabular-nums">
        {formatCurrency(summary.rent.current_month.weightedAmount)}
      </TableCell>
      <TableCell className="text-end font-medium tabular-nums">
        {formatCurrency(summary.rent.monthForecast)}
      </TableCell>
      <TableCell className="text-end tabular-nums">
        {count(summary.sale.no_date.proposals + summary.rent.no_date.proposals)}
      </TableCell>
    </>
  )
}

function BrokerForecastTable({ report, access }: { report: ForecastReport; access: ReportAccess }) {
  const groups =
    access !== "self" && countTeamGroups(report.brokers) > 1
      ? groupRowsByTeam(report.brokers)
      : null

  return (
    <Card>
      <CardHeader>
        <CardTitle>Por corretor</CardTitle>
        <CardDescription>
          Previsão = comprometido + ponderado das propostas com data prevista neste mês. Venda e
          locação ficam em colunas separadas e nunca se somam
          {groups ? "; o subtotal usa a equipe atual de cada corretor" : ""}.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="overflow-hidden rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Corretor</TableHead>
                <TableHead className="text-end">Venda comprometida</TableHead>
                <TableHead className="text-end">Venda ponderada</TableHead>
                <TableHead className="text-end">Previsão venda</TableHead>
                <TableHead className="text-end">Locação comprometida</TableHead>
                <TableHead className="text-end">Locação ponderada</TableHead>
                <TableHead className="text-end">Previsão locação</TableHead>
                <TableHead className="text-end">Sem data</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(groups ?? [{ teamId: null, teamName: "", rows: report.brokers }]).map((group) => (
                <BrokerForecastGroup
                  key={group.teamId ?? "sem-equipe"}
                  brokers={group.rows}
                  subtotalLabel={groups ? group.teamName : null}
                />
              ))}
            </TableBody>
            {report.brokers.length > 1 ? (
              <TableFooter>
                <TableRow>
                  <TableCell>Total</TableCell>
                  <ForecastNumberCells summary={report.summary} />
                </TableRow>
              </TableFooter>
            ) : null}
          </Table>
        </div>
      </CardContent>
    </Card>
  )
}

function BrokerForecastGroup({
  brokers,
  subtotalLabel,
}: {
  brokers: ForecastReport["brokers"]
  subtotalLabel: string | null
}) {
  return (
    <>
      {brokers.map((broker) => (
        <TableRow key={broker.userId ?? "sem-corretor"}>
          <TableCell>
            <div className="flex flex-col gap-0.5">
              <span className="font-medium">{broker.name}</span>
              {broker.teamName ? (
                <span className="text-xs text-muted-foreground">{broker.teamName}</span>
              ) : null}
            </div>
          </TableCell>
          <ForecastNumberCells summary={broker} />
        </TableRow>
      ))}
      {subtotalLabel ? (
        <TableRow className="bg-muted/40 font-medium">
          <TableCell>Subtotal · {subtotalLabel}</TableCell>
          <ForecastNumberCells summary={sumBrokerForecasts(brokers)} />
        </TableRow>
      ) : null}
    </>
  )
}

function proposalLabel(proposal: ForecastProposal) {
  return [proposal.propertyCode, proposal.propertyTitle].filter(Boolean).join(" · ") || "Proposta"
}

function ProposalItems({
  proposals,
  showDate,
}: {
  proposals: readonly ForecastProposal[]
  showDate: boolean
}) {
  return (
    <ItemGroup className="gap-2">
      {proposals.map((proposal) => (
        <Item key={proposal.id} variant="outline" size="sm" className="flex-wrap">
          <ItemContent className="min-w-0">
            <ItemTitle className="flex flex-wrap items-center gap-2">
              <span className="truncate">{proposalLabel(proposal)}</span>
              <Badge variant="outline">{LISTING_PURPOSE_LABELS[proposal.purpose]}</Badge>
            </ItemTitle>
            <ItemDescription className="tabular-nums">
              {formatCurrency(proposal.amount)} · {PROPOSAL_STATUS_LABELS[proposal.status]}
              {proposal.probability !== null ? ` (${count(proposal.probability)}%)` : ""} ·{" "}
              {proposal.brokerName ?? "Sem corretor"}
              {proposal.teamName ? ` · ${proposal.teamName}` : ""}
              {showDate && proposal.expectedCloseDate
                ? ` · previsão ${formatDateOnly(proposal.expectedCloseDate)}`
                : ""}
            </ItemDescription>
          </ItemContent>
          <ItemActions className="w-full @2xl/page:w-auto">
            {proposal.canEdit ? (
              <ExpectedCloseDateForm
                proposalId={proposal.id}
                proposalLabel={proposalLabel(proposal)}
                initialDate={proposal.expectedCloseDate}
              />
            ) : (
              <span className="text-xs text-muted-foreground">
                Só o corretor da proposta ou a gestão preenche.
              </span>
            )}
          </ItemActions>
        </Item>
      ))}
    </ItemGroup>
  )
}

function MissingDatesCard({ list, now }: { list: ForecastProposalList; now: Date }) {
  if (list.failed) {
    return <LoadError what="as propostas em aberto" />
  }

  const monthStart = `${todayInBrasilia(now).slice(0, 7)}-01`
  const withoutDate = list.proposals.filter((proposal) => proposal.expectedCloseDate === null)
  const overdue = list.proposals.filter(
    (proposal) => proposal.expectedCloseDate !== null && proposal.expectedCloseDate < monthStart
  )

  if (withoutDate.length === 0 && overdue.length === 0) {
    return (
      <ReportEmpty
        icon={CalendarClockIcon}
        title="Todas as propostas em aberto têm data prevista"
        description="Quando uma proposta nova entrar sem data prevista de fechamento, ela aparece aqui para ser preenchida."
      />
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Propostas para acertar a data prevista</CardTitle>
        <CardDescription>
          Proposta sem data prevista não entra na previsão do mês. Preencha aqui mesmo; a data
          também aparece na proposta.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        {withoutDate.length > 0 ? (
          <section className="flex flex-col gap-3" aria-labelledby="previsao-sem-data">
            <h3 id="previsao-sem-data" className="flex items-center gap-2 text-sm font-medium">
              <CalendarClockIcon className="size-4 text-muted-foreground" aria-hidden />
              Sem data prevista
              <Badge variant="secondary" className="tabular-nums">
                {count(withoutDate.length)}
              </Badge>
            </h3>
            <ProposalItems proposals={withoutDate} showDate={false} />
          </section>
        ) : null}
        {overdue.length > 0 ? (
          <section className="flex flex-col gap-3" aria-labelledby="previsao-vencida">
            <h3 id="previsao-vencida" className="flex items-center gap-2 text-sm font-medium">
              <CalendarXIcon className="size-4 text-muted-foreground" aria-hidden />
              Data prevista antes deste mês
              <Badge variant="secondary" className="tabular-nums">
                {count(overdue.length)}
              </Badge>
            </h3>
            <ProposalItems proposals={overdue} showDate />
          </section>
        ) : null}
      </CardContent>
      {list.truncated ? (
        <CardFooter className="text-muted-foreground">
          A lista mostra as primeiras propostas em aberto, sem data primeiro. Filtre por equipe ou
          corretor para ver as demais.
        </CardFooter>
      ) : null}
    </Card>
  )
}

function probabilityText(probabilities: readonly StageProbability[]) {
  if (probabilities.length === 0) {
    return "rascunho 10%, enviada 30% e contraproposta 50% (padrão)"
  }

  const text = probabilities
    .map(
      (item) => `${PROPOSAL_STATUS_LABELS[item.status].toLowerCase()} ${count(item.probability)}%`
    )
    .join(", ")

  return probabilities.every((item) => item.isDefault) ? `${text} (padrão)` : text
}

export function ForecastSection({
  report,
  proposals,
  probabilities,
  access,
  canAdjustProbabilities,
  now = new Date(),
}: {
  report: ForecastReport
  proposals: ForecastProposalList
  probabilities: readonly StageProbability[]
  access: ReportAccess
  canAdjustProbabilities: boolean
  now?: Date
}) {
  const monthLabel = new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    month: "long",
    year: "numeric",
  }).format(now)

  const intro = (
    <div className="flex flex-col gap-1">
      <h2 className="text-base font-medium">
        Previsão de <span className="capitalize">{monthLabel}</span>
      </h2>
      <p className="text-sm text-muted-foreground">
        Propostas em aberto com data prevista de fechamento neste mês, multiplicadas pela
        probabilidade da etapa ({probabilityText(probabilities)}), mais as aceitas no mês
        (comprometido).
        {canAdjustProbabilities ? (
          <>
            {" "}
            <Button
              variant="link"
              size="sm"
              className="h-auto px-0"
              nativeButton={false}
              render={<Link href={STAGE_PROBABILITIES_PATH} />}
            >
              Ajustar probabilidades
            </Button>
          </>
        ) : null}
      </p>
    </div>
  )

  if (report.failed) {
    return (
      <div className="flex flex-col gap-4">
        {intro}
        <LoadError what="a previsão de vendas" />
      </div>
    )
  }

  if (!hasForecastData(report.summary)) {
    return (
      <div className="flex flex-col gap-4">
        {intro}
        <ReportEmpty
          icon={TrendingUpIcon}
          title="Nenhuma proposta em aberto ou aceita neste mês"
          description="Cadastre as propostas com a data prevista de fechamento para ver quanto a equipe deve fechar no mês."
        />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      {intro}
      <div className="grid gap-4 @2xl/page:grid-cols-2">
        <PurposeCard purpose="sale" data={report.summary.sale} />
        <PurposeCard purpose="rent" data={report.summary.rent} />
      </div>
      <BrokerForecastTable report={report} access={access} />
      <MissingDatesCard list={proposals} now={now} />
    </div>
  )
}

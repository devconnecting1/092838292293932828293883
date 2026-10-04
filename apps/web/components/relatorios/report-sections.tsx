import type { ReactNode } from "react"
import Link from "next/link"
import {
  ChartNoAxesColumnIcon,
  FunnelIcon,
  SproutIcon,
  TriangleAlertIcon,
  UsersIcon,
  type LucideIcon,
} from "lucide-react"

import { formatHours, formatMinutes, formatRate } from "@workspace/core/reports/rates"
import { countTeamGroups, groupRowsByTeam } from "@workspace/core/reports/team-subtotals"
import { Alert, AlertDescription, AlertTitle } from "@workspace/ui/components/alert"
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
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@workspace/ui/components/empty"
import { Progress } from "@workspace/ui/components/progress"
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@workspace/ui/components/table"

import { FunnelChartView, type FunnelPoint } from "@/components/relatorios/funnel-chart"
import { ROLE_LABELS } from "@/lib/auth/roles"
import { formatCurrency } from "@/lib/format"
import type { ReportAccess } from "@/lib/relatorios/permissions"
import {
  sumBrokerRows,
  type BrokerReport,
  type BrokerReportTotals,
  type FunnelReport,
  type FunnelStageRow,
  type LostReasonReport,
  type SourceReport,
} from "@/lib/relatorios/queries"

/** Tela de lançamento de investimento em marketing (base do custo por lead). */
export const MARKETING_INVESTMENTS_PATH = "/marketing/investimentos"

const integerFormat = new Intl.NumberFormat("pt-BR")

export function count(value: number) {
  return integerFormat.format(value)
}

export function ReportEmpty({
  icon: Icon,
  title,
  description,
  children,
}: {
  icon: LucideIcon
  title: string
  description: string
  children?: ReactNode
}) {
  return (
    <Empty className="min-h-56 border">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Icon />
        </EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{description}</EmptyDescription>
      </EmptyHeader>
      {children}
    </Empty>
  )
}

export function LoadError({ what }: { what: string }) {
  return (
    <Alert variant="destructive">
      <TriangleAlertIcon />
      <AlertTitle>Não foi possível carregar {what}</AlertTitle>
      <AlertDescription>
        Recarregue a página em instantes. Enquanto isso, a exportação deste relatório também sai com
        o aviso de falha. Se continuar assim, confira se as migrações do banco foram aplicadas.
      </AlertDescription>
    </Alert>
  )
}

// -----------------------------------------------------------------------------
// Por corretor
// -----------------------------------------------------------------------------

/** Valor fechado com a quantidade embaixo ("R$ 1.200.000,00 / 2 vendas"). */
function ClosedCell({
  amount,
  quantity,
  singular,
  plural,
}: {
  amount: number
  quantity: number
  singular: string
  plural: string
}) {
  return (
    <TableCell className="text-end tabular-nums">
      <div className="flex flex-col items-end gap-0.5">
        <span>{formatCurrency(amount)}</span>
        <span className="text-xs text-muted-foreground">
          {count(quantity)} {quantity === 1 ? singular : plural}
        </span>
      </div>
    </TableCell>
  )
}

/** As colunas numéricas de uma linha, de um subtotal ou do total. */
function BrokerNumberCells({
  values,
  median,
}: {
  values: BrokerReportTotals
  median: number | null | undefined
}) {
  return (
    <>
      <TableCell className="text-end tabular-nums">{count(values.leadsReceived)}</TableCell>
      <TableCell className="text-end tabular-nums">
        {count(values.leadsAnswered)}
        <span className="text-muted-foreground"> ({formatRate(values.rates.answerRate)})</span>
      </TableCell>
      <TableCell className="text-end tabular-nums">
        {count(values.leadsInSla)}
        <span className="text-muted-foreground"> ({formatRate(values.rates.slaRate)})</span>
      </TableCell>
      <TableCell
        className={
          median === undefined ? "text-end text-muted-foreground" : "text-end tabular-nums"
        }
      >
        {median === undefined ? "—" : formatMinutes(median)}
      </TableCell>
      <TableCell className="text-end tabular-nums">{count(values.leadsWon)}</TableCell>
      <TableCell className="text-end tabular-nums">{count(values.leadsLost)}</TableCell>
      <TableCell className="text-end tabular-nums">{formatRate(values.rates.winRate)}</TableCell>
      <TableCell className="text-end tabular-nums">{count(values.leadsOpen)}</TableCell>
      <TableCell className="text-end tabular-nums">{count(values.propertiesCaptured)}</TableCell>
      <TableCell className="text-end tabular-nums">
        {count(values.proposalsClosed)}/{count(values.proposalsMade)}
      </TableCell>
      <ClosedCell
        amount={values.salesClosedAmount}
        quantity={values.salesClosed}
        singular="venda"
        plural="vendas"
      />
      <ClosedCell
        amount={values.rentalsClosedAmount}
        quantity={values.rentalsClosed}
        singular="locação"
        plural="locações"
      />
    </>
  )
}

export function BrokersSection({
  report,
  periodLabel,
  access,
}: {
  report: BrokerReport
  periodLabel: string
  access: ReportAccess
}) {
  if (report.failed) {
    return <LoadError what="o desempenho por corretor" />
  }

  if (report.rows.length === 0) {
    return (
      <ReportEmpty
        icon={UsersIcon}
        title="Nenhum corretor neste recorte"
        description="Assim que entrarem leads, captações ou propostas no período escolhido, cada corretor vira uma linha aqui. Com filtro de equipe, confira se a equipe tem membros."
      />
    )
  }

  const seesOthers = access !== "self"
  // Subtotal só quando há mais de um grupo: com uma equipe só, ele repetiria o total.
  const groups =
    seesOthers && countTeamGroups(report.rows) > 1 ? groupRowsByTeam(report.rows) : null

  return (
    <Card>
      <CardHeader>
        <CardTitle>Desempenho por corretor</CardTitle>
        <CardDescription>
          {periodLabel}. &quot;Recebidos&quot; são os leads entregues ao corretor no período;
          &quot;ganhos&quot; e &quot;perdidos&quot;, os que ele fechou ou perdeu no período, pelo
          histórico de etapa. &quot;Em aberto&quot; é a foto de hoje. Vendas e locações são as
          propostas aceitas no período, separadas pela finalidade
          {groups ? "; o subtotal usa a equipe atual de cada corretor" : ""}.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="overflow-hidden rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Corretor</TableHead>
                <TableHead className="text-end">Recebidos</TableHead>
                <TableHead className="text-end">Atendidos</TableHead>
                <TableHead className="text-end">No prazo</TableHead>
                <TableHead className="text-end">1º contato</TableHead>
                <TableHead className="text-end">Ganhos</TableHead>
                <TableHead className="text-end">Perdidos</TableHead>
                <TableHead className="text-end">Fechamento</TableHead>
                <TableHead className="text-end">Em aberto</TableHead>
                <TableHead className="text-end">Captações</TableHead>
                <TableHead className="text-end">Propostas</TableHead>
                <TableHead className="text-end">Vendas</TableHead>
                <TableHead className="text-end">Locações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(groups ?? [{ teamId: null, teamName: "", rows: report.rows }]).map((group) => (
                <BrokerGroupRows
                  key={group.teamId ?? "sem-equipe"}
                  rows={group.rows}
                  subtotalLabel={groups ? group.teamName : null}
                />
              ))}
            </TableBody>
            {seesOthers && report.rows.length > 1 ? (
              <TableFooter>
                <TableRow>
                  <TableCell>Total</TableCell>
                  <BrokerNumberCells values={report.totals} median={undefined} />
                </TableRow>
              </TableFooter>
            ) : null}
          </Table>
        </div>
      </CardContent>
      {seesOthers && report.rows.some((row) => row.leadsTakenBySla > 0) ? (
        <CardFooter className="flex-wrap gap-2 text-muted-foreground">
          Leads devolvidos à roleta por estouro do prazo:{" "}
          {report.rows
            .filter((row) => row.leadsTakenBySla > 0)
            .map((row) => `${row.name} (${count(row.leadsTakenBySla)})`)
            .join(" · ")}
          .
        </CardFooter>
      ) : null}
    </Card>
  )
}

function BrokerGroupRows({
  rows,
  subtotalLabel,
}: {
  rows: BrokerReport["rows"]
  /** Nome da equipe quando o grupo ganha linha de subtotal. */
  subtotalLabel: string | null
}) {
  return (
    <>
      {rows.map((row) => (
        <TableRow key={row.userId}>
          <TableCell>
            <div className="flex flex-col gap-0.5">
              <span className="font-medium">{row.name}</span>
              <span className="text-xs text-muted-foreground">
                {row.role ? ROLE_LABELS[row.role] : "Sem papel"}
                {row.teamName ? ` · ${row.teamName}` : ""}
                {row.active ? "" : " · inativo"}
              </span>
            </div>
          </TableCell>
          <BrokerNumberCells values={row} median={row.firstResponseMedianMinutes} />
        </TableRow>
      ))}
      {subtotalLabel ? (
        <TableRow className="bg-muted/40 font-medium">
          <TableCell>
            <div className="flex flex-col gap-0.5">
              <span>Subtotal · {subtotalLabel}</span>
              <span className="text-xs font-normal text-muted-foreground">
                {count(rows.length)} {rows.length === 1 ? "pessoa" : "pessoas"}
              </span>
            </div>
          </TableCell>
          <BrokerNumberCells values={sumBrokerRows(rows)} median={undefined} />
        </TableRow>
      ) : null}
    </>
  )
}

// -----------------------------------------------------------------------------
// Funil por etapa
// -----------------------------------------------------------------------------

/** Rótulos do gráfico montados no servidor, para o HTML dos dois lados bater. */
function funnelPoints(stages: readonly FunnelStageRow[]): FunnelPoint[] {
  return stages.map((stage) => ({
    label: stage.label,
    entered: stage.entered,
    advanced: stage.advanced,
    advanceLabel: stage.entered > 0 ? formatRate(stage.rates.advanceRate) : "",
    medianLabel: formatHours(stage.medianHours),
  }))
}

export function FunnelSection({
  report,
  periodLabel,
}: {
  report: FunnelReport
  periodLabel: string
}) {
  if (report.failed) {
    return <LoadError what="o funil por etapa" />
  }

  if (report.totalEntered === 0) {
    return (
      <ReportEmpty
        icon={FunnelIcon}
        title="Nenhuma mudança de etapa no período"
        description="O funil é montado a partir do histórico de etapa dos leads. Assim que a equipe mover leads no quadro, a conversão e o tempo em cada fase aparecem aqui."
      />
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Funil por etapa</CardTitle>
        <CardDescription>
          {periodLabel}. Sai do histórico de etapa de cada lead: quantos entraram em cada fase,
          quantos avançaram para a etapa seguinte (a taxa ao lado da barra), quantos se perderam
          depois e quanto tempo o lead ficou parado ali.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        <FunnelChartView data={funnelPoints(report.stages)} />

        <div className="overflow-hidden rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Etapa</TableHead>
                <TableHead className="text-end">Entraram</TableHead>
                <TableHead className="text-end">Avançaram</TableHead>
                <TableHead className="text-end">Conversão</TableHead>
                <TableHead className="text-end">Perderam</TableHead>
                <TableHead className="text-end">Ainda aqui</TableHead>
                <TableHead className="text-end">Tempo na etapa (mediana)</TableHead>
                <TableHead className="text-end">Tempo na etapa (média)</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {report.stages.map((stage) => (
                <TableRow key={stage.stage}>
                  <TableCell className="font-medium">{stage.label}</TableCell>
                  <TableCell className="text-end tabular-nums">{count(stage.entered)}</TableCell>
                  <TableCell className="text-end tabular-nums">{count(stage.advanced)}</TableCell>
                  <TableCell className="text-end tabular-nums">
                    {formatRate(stage.rates.advanceRate)}
                  </TableCell>
                  <TableCell className="text-end tabular-nums">{count(stage.lostAfter)}</TableCell>
                  <TableCell className="text-end tabular-nums">{count(stage.stillThere)}</TableCell>
                  <TableCell className="text-end tabular-nums">
                    {formatHours(stage.medianHours)}
                  </TableCell>
                  <TableCell className="text-end tabular-nums">
                    {formatHours(stage.avgHours)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>
      <CardFooter className="text-muted-foreground">
        Um lead que volta de etapa conta uma nova entrada, de propósito: retrabalho é informação. Ir
        para &quot;Perdido&quot; nunca conta como avanço.
      </CardFooter>
    </Card>
  )
}

// -----------------------------------------------------------------------------
// Origem do lead
// -----------------------------------------------------------------------------

function MarketingInvestmentsLink({ label }: { label: string }) {
  return (
    <Button
      variant="link"
      size="sm"
      className="h-auto px-0"
      nativeButton={false}
      render={<Link href={MARKETING_INVESTMENTS_PATH} />}
    >
      {label}
    </Button>
  )
}

/** Por que o custo por lead não aparece (ou está zerado) neste recorte. */
function SourceCostNotice({
  report,
  access,
  filtered,
  canManageInvestments,
}: {
  report: SourceReport
  access: ReportAccess
  filtered: boolean
  canManageInvestments: boolean
}) {
  if (report.totalInvestment === null) {
    if (access === "organization" && filtered) {
      return (
        <p>
          Investimento e custo por lead aparecem só na visão da imobiliária inteira, sem filtro de
          equipe ou corretor: o gasto em marketing não é dividido por equipe.
        </p>
      )
    }

    if (access !== "organization") {
      return <p>Investimento e custo por lead são vistos só pelo dono e pelo gerente.</p>
    }

    return null
  }

  if (report.totalInvestment === 0) {
    return (
      <p className="flex flex-wrap items-center gap-x-1">
        Nenhum investimento lançado para este período, então não há custo por lead.
        {canManageInvestments ? (
          <MarketingInvestmentsLink label="Lançar investimento em marketing" />
        ) : null}
      </p>
    )
  }

  return (
    <p className="flex flex-wrap items-center gap-x-1">
      Investimento do mês proporcional aos dias do período, dividido entre as linhas pela quantidade
      de leads.
      {canManageInvestments ? (
        <MarketingInvestmentsLink label="Ver ou lançar investimentos" />
      ) : null}
    </p>
  )
}

export function SourcesSection({
  report,
  periodLabel,
  access,
  filtered,
  canManageInvestments,
}: {
  report: SourceReport
  periodLabel: string
  access: ReportAccess
  /** Há filtro de equipe ou corretor (a RPC não traz investimento nesse caso). */
  filtered: boolean
  canManageInvestments: boolean
}) {
  if (report.failed) {
    return <LoadError what="a origem dos leads" />
  }

  if (report.rows.length === 0) {
    return (
      <ReportEmpty
        icon={SproutIcon}
        title="Nenhum lead no período"
        description="Publique a landing page ou cadastre um lead do telefone para descobrir qual origem traz gente que fecha, e não só gente que chega."
      >
        {canManageInvestments ? (
          <MarketingInvestmentsLink label="Lançar investimento em marketing" />
        ) : null}
      </ReportEmpty>
    )
  }

  const showCost = report.totalInvestment !== null

  return (
    <Card>
      <CardHeader>
        <CardTitle>Origem do lead</CardTitle>
        <CardDescription>
          {periodLabel}. Leads criados no período, agrupados por canal, landing page e campanha
          (utm). A coluna de conversão é o que separa a origem que traz volume da origem que traz
          negócio{showCost ? "; o custo por ganho mostra quanto custou cada negócio fechado" : ""}.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="overflow-hidden rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Canal</TableHead>
                <TableHead>Landing page</TableHead>
                <TableHead>Campanha</TableHead>
                <TableHead className="text-end">Leads</TableHead>
                <TableHead className="text-end">Atendidos</TableHead>
                <TableHead className="text-end">Ganhos</TableHead>
                <TableHead className="text-end">Perdidos</TableHead>
                <TableHead className="text-end">Conversão</TableHead>
                {showCost ? (
                  <>
                    <TableHead className="text-end">Investimento</TableHead>
                    <TableHead className="text-end">Custo por lead</TableHead>
                    <TableHead className="text-end">Custo por ganho</TableHead>
                  </>
                ) : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {report.rows.map((row) => (
                <TableRow key={row.key}>
                  <TableCell className="font-medium">{row.sourceLabel}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {row.landingPageName ?? "—"}
                  </TableCell>
                  <TableCell>
                    {row.utmCampaign || row.utmSource || row.utmMedium ? (
                      <div className="flex flex-wrap gap-1">
                        {row.utmCampaign ? (
                          <Badge variant="secondary">{row.utmCampaign}</Badge>
                        ) : null}
                        {row.utmSource ? <Badge variant="outline">{row.utmSource}</Badge> : null}
                        {row.utmMedium ? <Badge variant="outline">{row.utmMedium}</Badge> : null}
                      </div>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-end tabular-nums">{count(row.leads)}</TableCell>
                  <TableCell className="text-end tabular-nums">{count(row.answered)}</TableCell>
                  <TableCell className="text-end tabular-nums">{count(row.won)}</TableCell>
                  <TableCell className="text-end tabular-nums">{count(row.lost)}</TableCell>
                  <TableCell className="text-end tabular-nums">{formatRate(row.winRate)}</TableCell>
                  {showCost ? (
                    <>
                      <TableCell className="text-end tabular-nums">
                        {formatCurrency(row.investment)}
                      </TableCell>
                      <TableCell className="text-end tabular-nums">
                        {formatCurrency(row.costPerLead)}
                      </TableCell>
                      <TableCell className="text-end tabular-nums">
                        {formatCurrency(row.costPerWin)}
                      </TableCell>
                    </>
                  ) : null}
                </TableRow>
              ))}
            </TableBody>
            <TableFooter>
              <TableRow>
                <TableCell colSpan={3}>Total do período</TableCell>
                <TableCell className="text-end tabular-nums">{count(report.totalLeads)}</TableCell>
                <TableCell className="text-end text-muted-foreground">—</TableCell>
                <TableCell className="text-end tabular-nums">{count(report.totalWon)}</TableCell>
                <TableCell className="text-end text-muted-foreground">—</TableCell>
                <TableCell className="text-end text-muted-foreground">—</TableCell>
                {showCost ? (
                  <>
                    <TableCell className="text-end tabular-nums">
                      {formatCurrency(report.totalInvestment)}
                    </TableCell>
                    <TableCell className="text-end tabular-nums">
                      {formatCurrency(report.totalCostPerLead)}
                    </TableCell>
                    <TableCell className="text-end tabular-nums">
                      {formatCurrency(report.totalCostPerWin)}
                    </TableCell>
                  </>
                ) : null}
              </TableRow>
            </TableFooter>
          </Table>
        </div>
      </CardContent>
      <CardFooter className="flex-col items-start gap-1 text-muted-foreground">
        <SourceCostNotice
          report={report}
          access={access}
          filtered={filtered}
          canManageInvestments={canManageInvestments}
        />
      </CardFooter>
    </Card>
  )
}

// -----------------------------------------------------------------------------
// Motivo da perda
// -----------------------------------------------------------------------------

export function LostReasonsSection({
  report,
  periodLabel,
}: {
  report: LostReasonReport
  periodLabel: string
}) {
  if (report.failed) {
    return <LoadError what="os motivos de perda" />
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Por que os leads foram perdidos</CardTitle>
        <CardDescription>
          {periodLabel}. Leads que entraram em &quot;Perdido&quot;, agrupados pelo motivo anotado no
          registro.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {report.rows.length === 0 ? (
          <ReportEmpty
            icon={ChartNoAxesColumnIcon}
            title="Nenhum lead perdido no período"
            description="Quando um lead for para a coluna Perdido, o motivo anotado aparece aqui."
          />
        ) : (
          <ul className="flex flex-col gap-3">
            {report.rows.map((row) => (
              <li key={row.label} className="flex flex-col gap-1.5">
                <div className="flex items-baseline justify-between gap-4">
                  <span className="min-w-0 flex-1 truncate">{row.label}</span>
                  <span className="tabular-nums">
                    {count(row.total)}
                    <span className="text-muted-foreground"> ({formatRate(row.share)})</span>
                  </span>
                </div>
                <Progress value={(row.share ?? 0) * 100} />
              </li>
            ))}
          </ul>
        )}
      </CardContent>
      {report.total > 0 ? (
        <CardFooter className="text-muted-foreground">
          {count(report.total)} lead(s) perdido(s) no período.
        </CardFooter>
      ) : null}
    </Card>
  )
}

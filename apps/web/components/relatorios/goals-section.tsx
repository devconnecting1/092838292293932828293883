import { TargetIcon, UsersIcon } from "lucide-react"

import { formatRate } from "@workspace/core/reports/rates"
import {
  currentMonthKey,
  formatMonthLabel,
  GOAL_METRIC_LABELS,
  GOAL_METRICS,
  goalProgress,
  hasAnyGoal,
  isGoalAmountMetric,
  projectMonthEnd,
  shiftMonth,
  type GoalMetric,
} from "@workspace/core/reports/sales-goals"
import { Badge } from "@workspace/ui/components/badge"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"
import { Progress } from "@workspace/ui/components/progress"

import { CopyGoalsButton, GoalDialog } from "@/components/relatorios/goal-dialog"
import { count, LoadError, ReportEmpty } from "@/components/relatorios/report-sections"
import { ROLE_LABELS } from "@/lib/auth/roles"
import { formatCurrency } from "@/lib/format"
import type { GoalReport, GoalReportRow } from "@/lib/relatorios/goals"
import { goalNumbersToForm } from "@/lib/relatorios/goal-schemas"

function formatMetric(metric: GoalMetric, value: number) {
  return isGoalAmountMetric(metric) ? formatCurrency(value) : count(value)
}

/** Número inteiro projetado: quantidade arredondada, valor em reais. */
function formatProjection(metric: GoalMetric, value: number) {
  return isGoalAmountMetric(metric) ? formatCurrency(value) : count(Math.round(value))
}

function GoalCard({
  row,
  month,
  monthLabel,
  canEdit,
  isCurrentMonth,
}: {
  row: GoalReportRow
  month: string
  monthLabel: string
  canEdit: boolean
  isCurrentMonth: boolean
}) {
  const withGoal = GOAL_METRICS.filter((metric) => row.goal[metric] !== null)
  const withoutGoal = GOAL_METRICS.filter(
    (metric) => row.goal[metric] === null && row.actual[metric] > 0
  )
  const subtitle =
    row.kind === "team"
      ? "Soma dos membros atuais"
      : [row.role ? ROLE_LABELS[row.role] : null, row.teamName, row.active ? null : "inativo"]
          .filter(Boolean)
          .join(" · ")

  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle className="truncate">{row.name}</CardTitle>
        {subtitle ? <CardDescription>{subtitle}</CardDescription> : null}
        {canEdit ? (
          <CardAction>
            <GoalDialog
              month={month}
              monthLabel={monthLabel}
              kind={row.kind}
              targetId={row.targetId}
              targetName={row.name}
              initialValues={goalNumbersToForm(row.goal)}
              hasGoal={hasAnyGoal(row.goal)}
            />
          </CardAction>
        ) : null}
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {withGoal.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Sem meta neste mês.{canEdit ? " Use “Definir metas” para começar." : ""}
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {withGoal.map((metric) => {
              const goal = row.goal[metric] ?? 0
              const actual = row.actual[metric]
              const progress = goalProgress(actual, goal)
              const projection = isCurrentMonth ? projectMonthEnd(actual, month) : null

              return (
                <li key={metric} className="flex flex-col gap-1.5">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                    <span className="text-sm">{GOAL_METRIC_LABELS[metric]}</span>
                    <span className="text-sm tabular-nums">
                      {formatMetric(metric, actual)}
                      <span className="text-muted-foreground">
                        {" "}
                        de {formatMetric(metric, goal)} ({formatRate(progress.ratio)})
                      </span>
                    </span>
                  </div>
                  <Progress
                    value={progress.barValue}
                    aria-label={`${GOAL_METRIC_LABELS[metric]}: ${formatRate(progress.ratio)} da meta`}
                  />
                  {projection !== null && !progress.reached ? (
                    <span className="text-xs text-muted-foreground tabular-nums">
                      No ritmo atual, termina o mês com {formatProjection(metric, projection)}.
                    </span>
                  ) : progress.reached ? (
                    <span className="text-xs text-muted-foreground">Meta atingida.</span>
                  ) : null}
                </li>
              )
            })}
          </ul>
        )}
        {withoutGoal.length > 0 ? (
          <p className="text-xs text-muted-foreground tabular-nums">
            Realizado sem meta:{" "}
            {withoutGoal
              .map(
                (metric) =>
                  `${GOAL_METRIC_LABELS[metric]} ${formatMetric(metric, row.actual[metric])}`
              )
              .join(" · ")}
          </p>
        ) : null}
      </CardContent>
    </Card>
  )
}

export function GoalsSection({
  report,
  month,
  canEdit,
  now = new Date(),
}: {
  report: GoalReport
  month: string
  canEdit: boolean
  now?: Date
}) {
  if (report.failed) {
    return <LoadError what="as metas" />
  }

  const monthLabel = formatMonthLabel(month)
  const previousMonthLabel = formatMonthLabel(shiftMonth(month, -1))
  const isCurrentMonth = month === currentMonthKey(now)

  const header = (
    <div className="flex flex-col gap-3 @2xl/page:flex-row @2xl/page:items-start @2xl/page:justify-between">
      <div className="flex flex-col gap-1">
        <h2 className="text-base font-medium">
          Metas de <span className="capitalize">{monthLabel}</span>
        </h2>
        <p className="text-sm text-muted-foreground">
          Leads atendidos, visitas realizadas e propostas feitas no mês; vendas e locações são
          propostas aceitas no mês, separadas pela finalidade. É a mesma conta de &quot;Por
          corretor&quot; com o período do mês.
        </p>
      </div>
      {canEdit ? <CopyGoalsButton month={month} previousMonthLabel={previousMonthLabel} /> : null}
    </div>
  )

  if (report.teams.length === 0 && report.brokers.length === 0) {
    return (
      <div className="flex flex-col gap-4">
        {header}
        <ReportEmpty
          icon={TargetIcon}
          title="Ninguém neste recorte"
          description="Quando houver corretores ativos na imobiliária (ou na equipe escolhida), cada um ganha um cartão com a meta e o realizado do mês."
        />
      </div>
    )
  }

  const teamsWithGoal = report.teams.filter((row) => hasAnyGoal(row.goal)).length
  const brokersWithGoal = report.brokers.filter((row) => hasAnyGoal(row.goal)).length

  return (
    <div className="flex flex-col gap-6">
      {header}

      {report.teams.length > 0 ? (
        <section className="flex flex-col gap-3" aria-labelledby="metas-equipes">
          <div className="flex flex-wrap items-center gap-2">
            <UsersIcon className="size-4 text-muted-foreground" aria-hidden />
            <h3 id="metas-equipes" className="text-sm font-medium">
              Equipes
            </h3>
            <Badge variant="secondary" className="tabular-nums">
              {count(teamsWithGoal)} de {count(report.teams.length)} com meta
            </Badge>
          </div>
          <div className="grid gap-4 @2xl/page:grid-cols-2 @6xl/page:grid-cols-3">
            {report.teams.map((row) => (
              <GoalCard
                key={`team-${row.targetId}`}
                row={row}
                month={month}
                monthLabel={monthLabel}
                canEdit={canEdit}
                isCurrentMonth={isCurrentMonth}
              />
            ))}
          </div>
        </section>
      ) : null}

      {report.brokers.length > 0 ? (
        <section className="flex flex-col gap-3" aria-labelledby="metas-corretores">
          <div className="flex flex-wrap items-center gap-2">
            <TargetIcon className="size-4 text-muted-foreground" aria-hidden />
            <h3 id="metas-corretores" className="text-sm font-medium">
              Corretores
            </h3>
            <Badge variant="secondary" className="tabular-nums">
              {count(brokersWithGoal)} de {count(report.brokers.length)} com meta
            </Badge>
          </div>
          <div className="grid gap-4 @2xl/page:grid-cols-2 @6xl/page:grid-cols-3">
            {report.brokers.map((row) => (
              <GoalCard
                key={`broker-${row.targetId}`}
                row={row}
                month={month}
                monthLabel={monthLabel}
                canEdit={canEdit}
                isCurrentMonth={isCurrentMonth}
              />
            ))}
          </div>
        </section>
      ) : null}

      <p className="border-t pt-4 text-sm text-muted-foreground">
        {canEdit
          ? "Só o dono e o gerente definem metas. Copiar do mês anterior não sobrescreve metas já definidas neste mês."
          : "As metas são definidas pelo dono e pelo gerente."}{" "}
        Projeção: o ritmo dos dias já passados estendido ao mês inteiro.
      </p>
    </div>
  )
}

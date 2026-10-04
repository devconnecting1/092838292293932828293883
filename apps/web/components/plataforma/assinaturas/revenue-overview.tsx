import Link from "next/link"

import { formatBRL } from "@workspace/core/billing/format"
import {
  ACCOUNT_SITUATIONS,
  buildOrganizationListHref,
  PLATFORM_ORGANIZATIONS_PATH,
  PLATFORM_PLAN_KEYS,
  platformPlanLabel,
} from "@workspace/core/platform/accounts"
import { STRIPE_STATUS_LABELS } from "@workspace/core/platform/billing"
import { TRIAL_ENDING_WINDOW_DAYS, type RevenueSummary } from "@workspace/core/platform/revenue"
import { Badge } from "@workspace/ui/components/badge"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"

import { AccountSituationBadge } from "@/components/plataforma/imobiliarias/account-situation-badge"
import { formatDate, formatNumber } from "@/lib/format"

function Metric({
  label,
  value,
  detail,
}: {
  label: string
  value: string
  detail?: string | null
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-2xl font-semibold tabular-nums">{value}</dd>
      {detail ? <dd className="text-xs text-muted-foreground">{detail}</dd> : null}
    </div>
  )
}

/** Receita recorrente, ticket médio, novas assinaturas e cancelamentos do mês. */
export function RevenueMetrics({ summary }: { summary: RevenueSummary }) {
  const monthLabel = formatDate(summary.monthStart)

  return (
    <Card>
      <CardHeader>
        <CardTitle>Receita</CardTitle>
        <CardDescription>
          Receita recorrente mensal: contas ativas e com cobrança atrasada, plano anual convertido
          em mensal (÷ 12).
        </CardDescription>
      </CardHeader>
      <CardContent>
        <dl className="grid grid-cols-1 gap-6 min-[420px]:grid-cols-2 lg:grid-cols-5">
          <Metric
            label="Receita recorrente mensal"
            value={formatBRL(summary.mrrCents)}
            detail={
              summary.estimatedAccounts > 0
                ? `${formatNumber(summary.estimatedAccounts)} de ${formatNumber(summary.payingAccounts)} pelo preço de tabela (sem fatura paga sincronizada)`
                : `${formatNumber(summary.payingAccounts)} ${summary.payingAccounts === 1 ? "conta pagante" : "contas pagantes"}`
            }
          />
          <Metric
            label="Ticket médio"
            value={formatBRL(summary.averageTicketCents)}
            detail="Receita recorrente ÷ contas pagantes"
          />
          <Metric
            label="Receita em atraso"
            value={formatBRL(summary.atRiskMrrCents)}
            detail="Parte da receita com cobrança atrasada"
          />
          <Metric
            label="Novas assinaturas no mês"
            value={formatNumber(summary.newSubscriptionsThisMonth)}
            detail={`Primeira fatura paga desde ${monthLabel}`}
          />
          <Metric
            label="Cancelamentos no mês"
            value={formatNumber(summary.cancellationsThisMonth)}
            detail={`Assinaturas canceladas desde ${monthLabel}`}
          />
        </dl>
      </CardContent>
    </Card>
  )
}

/** Contas por situação e por plano, com atalho para a lista filtrada. */
export function AccountBreakdown({ summary }: { summary: RevenueSummary }) {
  return (
    <div className="grid gap-6 md:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Contas por situação</CardTitle>
          <CardDescription>
            {formatNumber(summary.totalAccounts)} {summary.totalAccounts === 1 ? "conta" : "contas"}{" "}
            no total.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="flex flex-col divide-y">
            {ACCOUNT_SITUATIONS.map((situation) => (
              <li key={situation} className="py-2 first:pt-0 last:pb-0">
                <Link
                  href={buildOrganizationListHref({ situacao: situation })}
                  className="flex items-center justify-between gap-3 text-sm hover:underline"
                >
                  <AccountSituationBadge situation={situation} />
                  <span className="font-medium tabular-nums">
                    {formatNumber(summary.bySituation[situation])}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Contas por plano</CardTitle>
          <CardDescription>Teste grátis inclui testes vencidos ainda sem plano.</CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="flex flex-col divide-y">
            {PLATFORM_PLAN_KEYS.map((plan) => (
              <li key={plan} className="py-2 first:pt-0 last:pb-0">
                <Link
                  href={buildOrganizationListHref({ plano: plan })}
                  className="flex items-center justify-between gap-3 text-sm hover:underline"
                >
                  <span>{platformPlanLabel(plan)}</span>
                  <span className="font-medium tabular-nums">
                    {formatNumber(summary.byPlan[plan])}
                  </span>
                </Link>
              </li>
            ))}
            {summary.byPlan.outro > 0 ? (
              <li className="flex items-center justify-between gap-3 py-2 text-sm last:pb-0">
                <span>Plano fora do catálogo</span>
                <span className="font-medium tabular-nums">
                  {formatNumber(summary.byPlan.outro)}
                </span>
              </li>
            ) : null}
          </ul>
        </CardContent>
      </Card>
    </div>
  )
}

function organizationHref(organizationId: string) {
  return `${PLATFORM_ORGANIZATIONS_PATH}/${organizationId}`
}

/** Testes que terminam nos próximos 7 dias e contas inadimplentes. */
export function RevenueWatchlists({ summary, now }: { summary: RevenueSummary; now: Date }) {
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Testes que terminam em {TRIAL_ENDING_WINDOW_DAYS} dias</CardTitle>
          <CardDescription>
            Do mais próximo ao mais distante. Contas bloqueadas ficam de fora.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {summary.trialsEndingSoon.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nenhum teste termina nos próximos {TRIAL_ENDING_WINDOW_DAYS} dias.
            </p>
          ) : (
            <ul className="flex flex-col divide-y">
              {summary.trialsEndingSoon.map((trial) => (
                <li
                  key={trial.organizationId}
                  className="flex min-w-0 flex-col gap-1 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between sm:gap-4"
                >
                  <div className="flex min-w-0 flex-col">
                    <Link
                      href={organizationHref(trial.organizationId)}
                      className="truncate text-sm font-medium underline-offset-4 hover:underline"
                    >
                      {trial.name}
                    </Link>
                    <span className="truncate font-mono text-xs text-muted-foreground">
                      {trial.slug}
                    </span>
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center gap-2">
                    {trial.controlledByStripe ? (
                      <Badge variant="outline">Teste na Stripe</Badge>
                    ) : null}
                    <span className="text-sm tabular-nums">
                      Termina em {formatDate(trial.endsAt)}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Inadimplentes</CardTitle>
          <CardDescription>
            Cobrança atrasada, não paga ou incompleta na Stripe, pela data em que a carência acaba.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {summary.delinquent.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhuma conta inadimplente.</p>
          ) : (
            <ul className="flex flex-col divide-y">
              {summary.delinquent.map((account) => (
                <li
                  key={account.organizationId}
                  className="flex min-w-0 flex-col gap-1 py-3 first:pt-0 last:pb-0"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <Link
                      href={organizationHref(account.organizationId)}
                      className="min-w-0 truncate text-sm font-medium underline-offset-4 hover:underline"
                    >
                      {account.name}
                    </Link>
                    <Badge variant="destructive">
                      {STRIPE_STATUS_LABELS[account.status]?.[0] ?? account.status}
                    </Badge>
                    {account.blocked ? <Badge variant="outline">Bloqueada</Badge> : null}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {[
                      platformPlanLabel(account.planKey),
                      account.monthlyCents !== null
                        ? `${formatBRL(account.monthlyCents)}/mês`
                        : null,
                      account.graceEndsAt
                        ? Date.parse(account.graceEndsAt) < now.getTime()
                          ? `carência terminou em ${formatDate(account.graceEndsAt)} (somente leitura)`
                          : `carência até ${formatDate(account.graceEndsAt)}`
                        : "sem período na Stripe (somente leitura)",
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

import {
  EMAIL_PRIORITY_LABELS,
  emailFailureLabel,
  emailKindLabel,
  emailPriorityCeiling,
  summarizeEmailQuota,
  type EmailPriority,
} from "@workspace/core/email/quota"
import { Badge } from "@workspace/ui/components/badge"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"

import { PlatformRpcFailureAlert } from "@/components/plataforma/platform-rpc-failure-alert"
import { formatNumber } from "@/lib/format"
import { getPlatformEmailQuota } from "@/lib/plataforma/email-quota"

const PRIORITIES: readonly EmailPriority[] = [1, 2, 3, 4, 5, 6]

function formatDay(day: string) {
  const [year, month, date] = day.split("-")
  return year && month && date ? `${date}/${month}` : day
}

/**
 * Cota de e-mail na Saúde do sistema: uso de hoje por prioridade, avisos não
 * enviados (por tipo e motivo) e os últimos 7 dias. Só contagens: nenhum
 * e-mail, nome ou imobiliária identificada.
 */
export async function EmailQuotaCard() {
  const result = await getPlatformEmailQuota()

  if (!result.ok) {
    return (
      <Card id="cota-email">
        <CardHeader>
          <CardTitle>Cota de e-mail</CardTitle>
        </CardHeader>
        <CardContent>
          <PlatformRpcFailureAlert failure={result} />
        </CardContent>
      </Card>
    )
  }

  const quota = result.data
  const summary = summarizeEmailQuota(quota.dailyLimit, quota.byPriority)
  const undelivered = quota.undeliveredByKind.reduce((total, row) => total + row.notices, 0)
  const byPriority = new Map(quota.byPriority.map((row) => [row.priority, row]))
  const status =
    undelivered > 0 || summary.blocked.length > 0
      ? summary.blocked.includes(1)
        ? { label: "Problema", variant: "destructive" as const }
        : { label: "Atenção", variant: "secondary" as const }
      : { label: "Tudo certo", variant: "outline" as const }

  return (
    <Card id="cota-email">
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle>Cota de e-mail</CardTitle>
          <Badge variant={status.variant}>{status.label}</Badge>
        </div>
        <CardDescription>
          Hoje ({formatDay(quota.day)}, horário de Brasília): {formatNumber(summary.used)} de{" "}
          {formatNumber(summary.limit)} envios usados. Reserva só para lead novo e convites:{" "}
          {formatNumber(summary.reserve)}. Limite em EMAIL_DAILY_LIMIT.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <div className="flex min-w-0 flex-col gap-1">
            <dt className="text-xs text-muted-foreground">Livres hoje</dt>
            <dd className="text-2xl font-semibold tabular-nums">{formatNumber(summary.free)}</dd>
          </div>
          <div className="flex min-w-0 flex-col gap-1">
            <dt className="text-xs text-muted-foreground">Negados pela cota</dt>
            <dd className="text-2xl font-semibold tabular-nums">{formatNumber(summary.denied)}</dd>
          </div>
          <div className="flex min-w-0 flex-col gap-1">
            <dt className="text-xs text-muted-foreground">Falhas no provedor</dt>
            <dd className="text-2xl font-semibold tabular-nums">{formatNumber(summary.failed)}</dd>
          </div>
          <div className="flex min-w-0 flex-col gap-1">
            <dt className="text-xs text-muted-foreground">Imobiliárias afetadas</dt>
            <dd className="text-2xl font-semibold tabular-nums">
              {formatNumber(quota.undeliveredOrganizations)}
            </dd>
          </div>
        </dl>

        <section className="flex flex-col gap-2" aria-label="Uso por prioridade">
          <h3 className="text-sm font-medium">Por prioridade</h3>
          <ul className="flex flex-col divide-y">
            {PRIORITIES.map((priority) => {
              const row = byPriority.get(priority)
              const blocked = summary.blocked.includes(priority)

              return (
                <li
                  key={priority}
                  className="flex flex-col gap-1 py-2 text-sm first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between sm:gap-3"
                >
                  <span className="min-w-0">
                    {priority}. {EMAIL_PRIORITY_LABELS[priority]}
                  </span>
                  <span className="flex flex-wrap items-center gap-2 text-muted-foreground tabular-nums">
                    {formatNumber(row?.sent ?? 0)} enviados
                    {row?.denied ? ` · ${formatNumber(row.denied)} negados` : ""}
                    {row?.failed ? ` · ${formatNumber(row.failed)} falhas` : ""}
                    {" · teto "}
                    {formatNumber(emailPriorityCeiling(quota.dailyLimit, priority))}
                    {blocked ? <Badge variant="secondary">Parado hoje</Badge> : null}
                  </span>
                </li>
              )
            })}
          </ul>
        </section>

        <section className="flex flex-col gap-2" aria-label="Avisos não enviados hoje">
          <h3 className="text-sm font-medium">
            Avisos não enviados hoje ({formatNumber(undelivered)})
          </h3>
          {quota.undeliveredByKind.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhum aviso ficou sem sair hoje.</p>
          ) : (
            <ul className="flex flex-col divide-y">
              {quota.undeliveredByKind.map((row) => (
                <li
                  key={`${row.kind}:${row.reason}`}
                  className="flex items-center justify-between gap-3 py-2 text-sm first:pt-0 last:pb-0"
                >
                  <span className="min-w-0">
                    {emailKindLabel(row.kind)}
                    <span className="block text-xs text-muted-foreground">
                      {emailFailureLabel(row.reason)}
                    </span>
                  </span>
                  <span className="tabular-nums">{formatNumber(row.notices)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        {quota.lastDays.length > 0 ? (
          <section className="flex flex-col gap-2" aria-label="Últimos 7 dias">
            <h3 className="text-sm font-medium">Últimos 7 dias</h3>
            <ul className="flex flex-col divide-y">
              {quota.lastDays.map((day) => (
                <li
                  key={day.day}
                  className="flex items-center justify-between gap-3 py-2 text-sm tabular-nums first:pt-0 last:pb-0"
                >
                  <span>{formatDay(day.day)}</span>
                  <span className="text-muted-foreground">
                    {formatNumber(day.sent)} enviados · {formatNumber(day.denied)} negados ·{" "}
                    {formatNumber(day.failed)} falhas
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </CardContent>
    </Card>
  )
}

import { summarizeHealth, type HealthStatus } from "@workspace/core/platform/health"
import { Card, CardContent, CardHeader, CardTitle } from "@workspace/ui/components/card"

import { PageHeading } from "@/components/crm/page-placeholder"
import { EmailQuotaCard } from "@/components/plataforma/email-quota-card"
import { HealthSectionCard } from "@/components/plataforma/health-section-card"
import { HealthStatusBadge } from "@/components/plataforma/health-status-badge"
import { PlatformRpcFailureAlert } from "@/components/plataforma/platform-rpc-failure-alert"
import { RefreshButton } from "@/components/plataforma/refresh-button"
import { PublicStatusSummaryCard } from "@/components/plataforma/status/public-status-summary-card"
import { formatDateTime, formatNumber } from "@/lib/format"
import { requirePlatformAdmin } from "@/lib/plataforma/admin"
import { loadPlatformHealth } from "@/lib/plataforma/health"
import { getPublicStatus } from "@/lib/status/public"

const SUMMARY_LABELS: Record<HealthStatus, string> = {
  problema: "Problemas",
  atencao: "Atenção",
  ok: "Tudo certo",
}

const SUMMARY_ORDER: readonly HealthStatus[] = ["problema", "atencao", "ok"]

/**
 * Saúde do sistema: /plataforma e /plataforma/saude. Só leitura; nenhuma ação
 * altera dado aqui. Sem PLATFORM_SERVER_KEY, as partes globais aparecem como
 * indisponíveis com o aviso de configuração, e o resto continua.
 */
export async function PlatformHealthPage() {
  await requirePlatformAdmin()

  const [report, publicStatus] = await Promise.all([loadPlatformHealth(), getPublicStatus()])
  const summary = summarizeHealth(report.sections)

  return (
    <div className="flex flex-1 flex-col gap-6 p-4 lg:p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <PageHeading
          title="Saúde do sistema"
          description={`Verificado em ${formatDateTime(report.checkedAt)}. Só presença, contagens e estados: nenhum segredo nem dado pessoal aparece aqui.`}
        />
        <RefreshButton />
      </div>

      {report.databaseFailure ? <PlatformRpcFailureAlert failure={report.databaseFailure} /> : null}

      <Card>
        <CardHeader>
          <CardTitle>Resumo</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <dl className="grid grid-cols-3 gap-4">
            {SUMMARY_ORDER.map((status) => (
              <div key={status} className="flex min-w-0 flex-col gap-1">
                <dt className="text-xs text-muted-foreground">{SUMMARY_LABELS[status]}</dt>
                <dd className="text-2xl font-semibold tabular-nums">
                  {formatNumber(summary[status])}
                </dd>
              </div>
            ))}
          </dl>
          <ul className="flex flex-col divide-y">
            {report.sections.map((section) => (
              <li key={section.key} className="py-2 first:pt-0 last:pb-0">
                <a
                  href={`#${section.key}`}
                  className="flex items-center justify-between gap-3 text-sm hover:underline"
                >
                  <span className="min-w-0 truncate">{section.title}</span>
                  <HealthStatusBadge status={section.status} />
                </a>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <PublicStatusSummaryCard snapshot={publicStatus} />

      <EmailQuotaCard />

      {report.sections.map((section) => (
        <HealthSectionCard key={section.key} section={section} />
      ))}
    </div>
  )
}

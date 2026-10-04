import {
  CircleAlertIcon,
  CircleCheckIcon,
  CircleDashedIcon,
  KeyRoundIcon,
  MailIcon,
  TriangleAlertIcon,
} from "lucide-react"

import {
  AUTO_INCIDENT_RULES_SUMMARY,
  describeVendorSignal,
  STATUS_ALERTS_SETUP_SQL,
  VENDOR_READING_RESULT_LABELS,
  vendorSignalState,
  VENDORS_NOT_MONITORED,
  type VendorSignalState,
} from "@workspace/core/status/automation"
import { Alert, AlertDescription, AlertTitle } from "@workspace/ui/components/alert"
import { Badge } from "@workspace/ui/components/badge"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"

import { formatDateTime, formatNumber } from "@/lib/format"
import type { StatusAlertsQueue, StatusAutomationRun, StatusVendor } from "@/lib/status/console"

const VENDOR_BADGES: Record<
  VendorSignalState,
  { label: string; variant: "secondary" | "outline" | "destructive" }
> = {
  operacional: { label: "Operacional", variant: "secondary" },
  incidente: { label: "Com incidente", variant: "outline" },
  sem_leitura: { label: "Sem leitura recente", variant: "outline" },
}

function VendorBadge({ state }: { state: VendorSignalState }) {
  const { label, variant } = VENDOR_BADGES[state]
  const Icon =
    state === "operacional"
      ? CircleCheckIcon
      : state === "incidente"
        ? TriangleAlertIcon
        : CircleDashedIcon

  return (
    <Badge variant={variant}>
      <Icon data-icon="inline-start" />
      {label}
    </Badge>
  )
}

/** Um erro só conta como "agora" se veio perto da última passada. */
function hasRecentError(run: StatusAutomationRun): boolean {
  if (!run.lastError || !run.lastErrorAt || !run.lastRunAt) {
    return false
  }

  return Date.parse(run.lastRunAt) - Date.parse(run.lastErrorAt) < 10 * 60_000
}

/**
 * Incidentes automáticos (regras fixas, sem IA), fornecedores e o aviso por
 * e-mail aos Donos. Só para a equipe: nada daqui vai ao público.
 */
export function AutomationCard({
  automation,
  vendors,
  alerts,
  now,
}: {
  automation: StatusAutomationRun
  vendors: readonly StatusVendor[]
  alerts: StatusAlertsQueue
  now: Date
}) {
  const enabledVendors = vendors.filter((vendor) => vendor.enabled)

  return (
    <Card>
      <CardHeader>
        <CardTitle>Incidentes automáticos</CardTitle>
        <CardDescription>
          O banco confere as medições a cada minuto e abre, atualiza e resolve incidentes sozinho,
          com texto de modelo e selo “Detectado automaticamente”. Sem IA e sem custo extra.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        {hasRecentError(automation) ? (
          <Alert variant="destructive">
            <CircleAlertIcon />
            <AlertTitle>A última passada da automação falhou</AlertTitle>
            <AlertDescription>
              Código {automation.lastError} em {formatDateTime(automation.lastErrorAt)}. As medições
              continuam sendo gravadas; só a abertura e a atualização automática de incidentes
              ficaram paradas nesse minuto.
            </AlertDescription>
          </Alert>
        ) : null}

        <section className="flex flex-col gap-2">
          <h3 className="text-sm font-medium">Regras</h3>
          <ul className="flex list-disc flex-col gap-1 ps-5 text-sm text-muted-foreground">
            {AUTO_INCIDENT_RULES_SUMMARY.map((rule) => (
              <li key={rule}>{rule}</li>
            ))}
          </ul>
          <p className="text-xs text-muted-foreground tabular-nums">
            Última passada:{" "}
            {automation.lastRunAt ? formatDateTime(automation.lastRunAt) : "ainda não rodou"}
          </p>
        </section>

        <section className="flex flex-col gap-2">
          <h3 className="text-sm font-medium">Fornecedores</h3>
          <p className="text-sm text-muted-foreground">
            Situação pública de quem hospeda o sistema, lida a cada 5 minutos da API oficial de
            status. Só sinal interno: nunca muda a página pública. Quando coincide com um incidente
            automático, o texto diz “possível relação com instabilidade em um fornecedor de
            infraestrutura”, sem citar nome.
          </p>
          {enabledVendors.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhum fornecedor acompanhado.</p>
          ) : (
            <ul className="flex flex-col divide-y rounded-lg border" aria-label="Fornecedores">
              {enabledVendors.map((vendor) => {
                const state = vendorSignalState(vendor, now)

                return (
                  <li
                    key={vendor.key}
                    className="flex min-w-0 flex-col gap-1 p-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4"
                  >
                    <div className="flex min-w-0 flex-col gap-0.5">
                      <span className="font-medium">{describeVendorSignal(vendor, now)}</span>
                      <span className="text-xs text-muted-foreground tabular-nums">
                        {vendor.checkedAt
                          ? `Lido em ${formatDateTime(vendor.checkedAt)}`
                          : "Nenhuma leitura ainda"}
                        {vendor.lastResult && vendor.lastResult !== "ok"
                          ? ` · Última tentativa: ${VENDOR_READING_RESULT_LABELS[vendor.lastResult] ?? vendor.lastResult}`
                          : null}
                      </span>
                    </div>
                    <div className="sm:shrink-0">
                      <VendorBadge state={state} />
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
          <p className="text-xs text-muted-foreground">
            Fora do acompanhamento:{" "}
            {VENDORS_NOT_MONITORED.map((vendor) => `${vendor.name} (${vendor.reason})`).join(" ")}
          </p>
        </section>

        <section className="flex flex-col gap-2">
          <h3 className="text-sm font-medium">Aviso por e-mail aos Donos</h3>
          <p className="text-sm text-muted-foreground">
            Sai para PLATFORM_ADMIN_EMAILS quando um incidente automático chega a impacto grande ou
            crítico e quando ele se resolve sozinho. No máximo {formatNumber(alerts.emailsLimit)}{" "}
            e-mails em 24 horas no total.
          </p>
          {alerts.webhookConfigured ? null : (
            <Alert>
              <KeyRoundIcon />
              <AlertTitle>O aviso por e-mail não está ligado</AlertTitle>
              <AlertDescription>
                <p>
                  Sem os segredos do webhook no Vault, o aviso fica na fila e expira em 6 horas. Os
                  incidentes continuam aparecendo aqui e na página pública.
                </p>
                <p>No SQL Editor do Supabase, trocando os marcadores:</p>
                {STATUS_ALERTS_SETUP_SQL.map((command) => (
                  <code key={command} className="block font-mono break-all">
                    {command}
                  </code>
                ))}
              </AlertDescription>
            </Alert>
          )}
          <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <div className="flex min-w-0 flex-col gap-1">
              <dt className="text-xs text-muted-foreground">Webhook</dt>
              <dd className="flex items-center gap-1.5 font-medium">
                <MailIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
                {alerts.webhookConfigured ? "Configurado" : "Ausente"}
              </dd>
            </div>
            <div className="flex min-w-0 flex-col gap-1">
              <dt className="text-xs text-muted-foreground">E-mails em 24 h</dt>
              <dd className="font-medium tabular-nums">
                {formatNumber(alerts.emailsUsed24h)} de {formatNumber(alerts.emailsLimit)}
              </dd>
            </div>
            <div className="flex min-w-0 flex-col gap-1">
              <dt className="text-xs text-muted-foreground">Na fila</dt>
              <dd className="font-medium tabular-nums">{formatNumber(alerts.pending)}</dd>
            </div>
            <div className="flex min-w-0 flex-col gap-1">
              <dt className="text-xs text-muted-foreground">Último enviado</dt>
              <dd className="font-medium tabular-nums">
                {alerts.lastSentAt ? formatDateTime(alerts.lastSentAt) : "Nenhum"}
              </dd>
            </div>
          </dl>
          {alerts.expiredLast7d > 0 ? (
            <p className="text-xs text-muted-foreground">
              {formatNumber(alerts.expiredLast7d)} aviso(s) expiraram sem sair nos últimos 7 dias
              (webhook ausente, trava cheia ou falha de envio).
            </p>
          ) : null}
        </section>
      </CardContent>
    </Card>
  )
}

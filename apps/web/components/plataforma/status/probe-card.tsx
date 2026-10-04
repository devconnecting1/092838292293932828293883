import {
  CircleAlertIcon,
  CircleCheckIcon,
  CircleDashedIcon,
  KeyRoundIcon,
  TimerOffIcon,
  TriangleAlertIcon,
} from "lucide-react"

import { describeProbeResult, STATUS_PROBE_SETUP_SQL } from "@workspace/core/status/measurements"
import { Alert, AlertDescription, AlertTitle } from "@workspace/ui/components/alert"
import { Badge } from "@workspace/ui/components/badge"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"

import { formatDateTime, formatNumber } from "@/lib/format"
import type { StatusProbeResult, StatusProbeState } from "@/lib/status/console"

/**
 * Avisos de configuração da medição automática: sem o segredo da sonda, as
 * partes que dependem dela ficam sem medição (barra cinza, nunca vermelha);
 * sem a rotina, nenhuma parte é medida.
 */
export function ProbeSetupAlerts({ probe }: { probe: StatusProbeState }) {
  return (
    <>
      {!probe.urlConfigured ? (
        <Alert>
          <KeyRoundIcon />
          <AlertTitle>A sonda do app não está configurada</AlertTitle>
          <AlertDescription>
            <p>
              Sem o segredo status_probe_url no Vault, a sonda HTTP não roda: CRM, Login e contas e
              Landing pages e captação ficam sem medição (barra cinza para o público, nunca
              vermelha). As outras partes continuam medidas.
            </p>
            <p>
              No SQL Editor do Supabase, trocando pelo domínio de produção:{" "}
              <code className="font-mono break-all">{STATUS_PROBE_SETUP_SQL}</code>
            </p>
          </AlertDescription>
        </Alert>
      ) : null}

      {probe.jobActive !== true ? (
        <Alert>
          <TimerOffIcon />
          <AlertTitle>
            {probe.jobActive === null
              ? "A rotina de medições não existe"
              : "A rotina de medições está desligada"}
          </AlertTitle>
          <AlertDescription>
            {probe.jobActive === null
              ? "A rotina status-publico-medicoes não foi encontrada no agendador do banco: nenhuma parte recebe medição automática e as barras ficam cinza. Confira se a migração da página de status foi aplicada."
              : "A rotina status-publico-medicoes existe, mas está inativa: nenhuma parte recebe medição automática e as barras ficam cinza. Reative a rotina no agendador do banco (pg_cron)."}
          </AlertDescription>
        </Alert>
      ) : null}
    </>
  )
}

const PROBE_BADGES: Record<
  "ok" | "lento" | "falha" | "configuracao",
  { label: string; variant: "secondary" | "outline" | "destructive" }
> = {
  ok: { label: "Respondendo", variant: "secondary" },
  lento: { label: "Lenta", variant: "outline" },
  falha: { label: "Falhando", variant: "destructive" },
  configuracao: { label: "Conferir configuração", variant: "outline" },
}

function probeBadgeKey(result: StatusProbeResult): keyof typeof PROBE_BADGES {
  switch (result) {
    case "ok":
      return "ok"
    case "lento":
      return "lento"
    case "http_erro":
    case "tempo_esgotado":
    case "erro_conexao":
      return "falha"
    default:
      return "configuracao"
  }
}

function ProbeBadge({ result }: { result: StatusProbeResult | null }) {
  if (!result) {
    return (
      <Badge variant="outline">
        <CircleDashedIcon data-icon="inline-start" />
        Sem dados
      </Badge>
    )
  }

  const key = probeBadgeKey(result)
  const { label, variant } = PROBE_BADGES[key]
  const Icon =
    key === "ok" ? CircleCheckIcon : key === "falha" ? CircleAlertIcon : TriangleAlertIcon

  return (
    <Badge variant={variant}>
      <Icon data-icon="inline-start" />
      {label}
    </Badge>
  )
}

/** Último resultado da sonda HTTP ao app (/api/status/ping). Só para o console. */
export function ProbeCard({ probe }: { probe: StatusProbeState }) {
  const facts: { label: string; value: string }[] = [
    { label: "Último resultado", value: describeProbeResult(probe.lastResult) },
    {
      label: "Resposta HTTP",
      value: probe.lastHttpStatus === null ? "—" : String(probe.lastHttpStatus),
    },
    {
      label: "Duração",
      value: probe.lastDurationMs === null ? "—" : `${formatNumber(probe.lastDurationMs)} ms`,
    },
    { label: "Enviada em", value: formatDateTime(probe.lastSentAt) },
    { label: "Verificada em", value: formatDateTime(probe.lastCheckedAt) },
    {
      label: "Segredo status_probe_url",
      value: probe.urlConfigured ? "Configurado" : "Ausente",
    },
    {
      label: "Rotina de medições",
      value: probe.jobActive === null ? "Não encontrada" : probe.jobActive ? "Ativa" : "Desligada",
    },
  ]

  return (
    <Card>
      <CardHeader>
        <CardTitle>Sonda do app</CardTitle>
        <CardDescription>
          O banco chama /api/status/ping a cada minuto (app, banco e Auth). Mede CRM, Login e contas
          e Landing pages e captação.
        </CardDescription>
        <CardAction>
          <ProbeBadge result={probe.lastResult} />
        </CardAction>
      </CardHeader>
      <CardContent>
        <dl className="grid gap-3 sm:grid-cols-[auto_minmax(0,1fr)] sm:gap-x-4 sm:gap-y-2">
          {facts.map((fact) => (
            <div key={fact.label} className="flex min-w-0 flex-col gap-0.5 sm:contents">
              <dt className="text-xs text-muted-foreground sm:text-sm">{fact.label}</dt>
              <dd className="min-w-0 break-words tabular-nums">{fact.value}</dd>
            </div>
          ))}
        </dl>
      </CardContent>
    </Card>
  )
}

import type { Metadata } from "next"
import { CircleAlertIcon, ExternalLinkIcon } from "lucide-react"

import { formatBrDate } from "@workspace/core/caixa/normalize"
import { CAIXA_DOWNLOAD_PAGE_URL } from "@workspace/core/caixa/source"
import { decideCaixaUploadReminder } from "@workspace/core/caixa/upload-reminder"
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

import { PageHeading } from "@/components/crm/page-placeholder"
import { PlatformReadOnlyNotice } from "@/components/plataforma/equipe/read-only-notice"
import { formatDateTime, formatNumber } from "@/lib/format"
import { canAct, requirePlatformAdmin } from "@/lib/plataforma/admin"
import {
  CAIXA_EVENTS_LIMIT,
  getCaixaLoadSummary,
  listCaixaSyncEvents,
  type CaixaSyncEvent,
} from "@/lib/plataforma/caixa-queries"
import { CAIXA_ORIGIN_LABELS, caixaFailureLabel } from "@/lib/plataforma/caixa-labels"
import { createClient } from "@/lib/supabase/server"

import { CaixaUploadForm } from "./_components/caixa-upload-form"

export const metadata: Metadata = {
  title: "Imóveis da Caixa",
}

/**
 * Console da Plataforma (fora do CRM das imobiliárias): envio manual da lista
 * oficial de imóveis da Caixa. A casca (menu, cabeçalho e noindex) vem de
 * app/plataforma/layout.tsx. O download automático é
 * bloqueado pela proteção anti-robô do site da Caixa e não é contornado.
 *
 * Quem não é da equipe recebe 404 (requirePlatformAdmin, aqui e no layout: o
 * layout não roda de novo na navegação pelo menu). "Somente leitura" vê a página
 * com o envio desabilitado (a rota de envio recusa de novo).
 */
export default async function PlataformaCaixaPage() {
  const admin = await requirePlatformAdmin()
  const readOnly = !canAct(admin)

  const supabase = await createClient()
  const [summary, events] = await Promise.all([
    getCaixaLoadSummary(supabase),
    listCaixaSyncEvents(supabase),
  ])

  const listDate = formatBrDate(summary?.lista_gerada_em)
  const loadedAt = summary?.sincronizado_em ?? null
  const reminder = decideCaixaUploadReminder(loadedAt, new Date())
  const lastFailureIsNewer =
    summary?.last_result === "falha" &&
    summary.last_failure_at !== null &&
    (!loadedAt || Date.parse(summary.last_failure_at) > Date.parse(loadedAt))

  return (
    <div className="flex flex-1 flex-col p-4 lg:p-6">
      <div className="flex w-full max-w-3xl min-w-0 flex-col gap-6">
        <PageHeading
          title="Lista de imóveis da Caixa"
          description="O catálogo que as imobiliárias veem em Imóveis da Caixa vem daqui. Envie a lista oficial sempre que a Caixa publicar uma nova (normalmente todo dia)."
        />

        <Card>
          <CardHeader>
            <CardTitle>Última carga</CardTitle>
            <CardDescription>
              {listDate ? `Lista da Caixa de ${listDate}` : "Nenhuma lista carregada ainda."}
            </CardDescription>
            {loadedAt ? (
              <CardAction>
                {reminder.send ? (
                  <Badge variant="destructive">Mais de 24 h</Badge>
                ) : (
                  <Badge variant="secondary">Em dia</Badge>
                )}
              </CardAction>
            ) : null}
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
              <SummaryItem label="Data declarada pela Caixa" value={listDate ?? "—"} />
              <SummaryItem label="Carregada em" value={loadedAt ? formatDateTime(loadedAt) : "—"} />
              <SummaryItem label="Imóveis ativos" value={formatNumber(summary?.total_ativo ?? 0)} />
              <SummaryItem
                label="Recusados"
                value={loadedAt ? formatNumber(summary?.ultima_carga_recusada ?? 0) : "—"}
              />
              <SummaryItem
                label="Saíram da lista"
                value={loadedAt ? formatNumber(summary?.ultima_carga_saiu ?? 0) : "—"}
              />
            </dl>
            {lastFailureIsNewer ? (
              <Alert variant="destructive">
                <CircleAlertIcon />
                <AlertTitle>
                  A última tentativa falhou em {formatDateTime(summary.last_failure_at)}
                </AlertTitle>
                <AlertDescription>
                  {caixaFailureLabel(summary.last_failure_reason) ?? "Motivo não informado."} O
                  catálogo anterior continua valendo.
                </AlertDescription>
              </Alert>
            ) : null}
          </CardContent>
        </Card>

        {readOnly ? <PlatformReadOnlyNotice /> : null}

        <Card>
          <CardHeader>
            <CardTitle>Enviar a lista atualizada</CardTitle>
            <CardDescription>Leva dois minutos, pelo navegador.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-6">
            <ol className="flex list-decimal flex-col gap-2 ps-5 text-sm">
              <li>
                Abra a{" "}
                <a
                  href={CAIXA_DOWNLOAD_PAGE_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 font-medium underline underline-offset-2"
                >
                  página oficial de download da Caixa
                  <ExternalLinkIcon aria-hidden="true" className="size-3" />
                </a>
                .
              </li>
              <li>
                Escolha a lista geral (<strong>Todos os estados</strong>), não a de um estado só.
              </li>
              <li>Baixe o arquivo (Lista_imoveis_geral.csv). Não abra nem salve no Excel.</li>
              <li>Envie o arquivo aqui embaixo.</li>
            </ol>
            <CaixaUploadForm readOnly={readOnly} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Últimos registros</CardTitle>
            <CardDescription>
              As {CAIXA_EVENTS_LIMIT} cargas e falhas mais recentes. Envio repetido de um arquivo
              igual não gera registro.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {events.length > 0 ? (
              <ul className="flex flex-col divide-y">
                {events.map((event) => (
                  <EventRow key={event.id} event={event} />
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">Nenhum registro ainda.</p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

function SummaryItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm font-medium break-words">{value}</dd>
    </div>
  )
}

function EventRow({ event }: { event: CaixaSyncEvent }) {
  const ok = event.resultado === "ok"
  const origin =
    event.origem === "envio_manual" || event.origem === "download_automatico"
      ? CAIXA_ORIGIN_LABELS[event.origem]
      : event.origem
  const listDate = formatBrDate(event.lista_gerada_em)
  const details = ok
    ? [
        listDate ? `Lista de ${listDate}` : null,
        event.total != null ? `${formatNumber(event.total)} ativos` : null,
        event.sairam != null ? `${formatNumber(event.sairam)} saíram` : null,
        event.recusados != null ? `${formatNumber(event.recusados)} recusados` : null,
      ]
        .filter(Boolean)
        .join(" · ")
    : caixaFailureLabel(event.motivo)

  return (
    <li className="flex flex-col gap-1 py-3 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium">{formatDateTime(event.ocorrido_em)}</span>
        <Badge variant={ok ? "secondary" : "destructive"}>
          {ok ? "Carga concluída" : "Falhou"}
        </Badge>
        <Badge variant="outline">{origin}</Badge>
      </div>
      {details ? <p className="text-sm text-muted-foreground">{details}</p> : null}
    </li>
  )
}

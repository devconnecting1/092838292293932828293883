"use client"

import * as React from "react"
import Link from "next/link"
import { CircleAlertIcon, CircleCheckIcon, ImagesIcon, InfoIcon, RotateCcwIcon } from "lucide-react"

import type { ImportKind } from "@workspace/core/import/fields"
import type { ImportRowProblem, ImportSummary } from "@workspace/core/import/report"
import { Alert, AlertDescription, AlertTitle } from "@workspace/ui/components/alert"
import { Button } from "@workspace/ui/components/button"
import { Item, ItemContent, ItemDescription, ItemTitle } from "@workspace/ui/components/item"
import { Progress, ProgressLabel, ProgressValue } from "@workspace/ui/components/progress"

import { ProblemList } from "@/components/importacao/problem-list"
import { UndoImportButton } from "@/components/importacao/undo-import-button"
import type { ImportPhotoStatus } from "@/lib/importacao/actions"
import { IMPORT_LIST_PATHS, IMPORT_UNDO_DAYS } from "@/lib/importacao/constants"

const LIST_LABELS: Record<ImportKind, string> = {
  clients: "Ver clientes",
  leads: "Ver leads",
  properties: "Ver imóveis",
}

function formatCount(value: number) {
  return value.toLocaleString("pt-BR")
}

export function ResultStep({
  kind,
  jobId,
  summary,
  problems,
  photos,
  photosRunning,
  photoError,
  photoNotice,
  onRetryPhotos,
  onDownloadErrors,
  onRestart,
}: {
  kind: ImportKind
  jobId: string
  summary: ImportSummary
  problems: readonly ImportRowProblem[]
  photos: ImportPhotoStatus | null
  photosRunning: boolean
  photoError: string | null
  photoNotice: string | null
  onRetryPhotos: () => void
  onDownloadErrors: () => void
  onRestart: () => void
}) {
  const [undone, setUndone] = React.useState(false)
  const errors = problems.filter((problem) => problem.status === "failed")
  const stats = [
    { label: "Importados", value: summary.inserted },
    { label: "Atualizados", value: summary.updated },
    { label: "Ignorados (já existiam ou repetidos)", value: summary.skipped },
    { label: "Com erro", value: summary.failed },
  ]

  return (
    <div className="flex flex-col gap-6">
      <Alert>
        <CircleCheckIcon />
        <AlertTitle>Importação concluída</AlertTitle>
        <AlertDescription>
          {formatCount(summary.totalRows)} {summary.totalRows === 1 ? "linha lida" : "linhas lidas"}
          . A importação ficou registrada na auditoria, só com as contagens. Dá para desfazer em até{" "}
          {IMPORT_UNDO_DAYS} dias.
        </AlertDescription>
      </Alert>

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((stat) => (
          <Item key={stat.label} variant="muted" size="sm">
            <ItemContent>
              <ItemTitle className="tabular-nums">{formatCount(stat.value)}</ItemTitle>
              <ItemDescription>{stat.label}</ItemDescription>
            </ItemContent>
          </Item>
        ))}
      </div>

      {summary.drafts > 0 ? (
        <Alert>
          <InfoIcon />
          <AlertTitle>
            {formatCount(summary.drafts)}{" "}
            {summary.drafts === 1
              ? "imóvel entrou como rascunho"
              : "imóveis entraram como rascunho"}
          </AlertTitle>
          <AlertDescription>
            Faltou preço ou área para ficar ativo. Complete no cadastro do imóvel e mude a situação
            para ativo.
          </AlertDescription>
        </Alert>
      ) : null}

      {photos && photos.total > 0 ? (
        <div className="flex flex-col gap-3">
          <Progress
            value={Math.round(((photos.done + photos.failed) / Math.max(photos.total, 1)) * 100)}
          >
            <ProgressLabel>
              {photosRunning
                ? `Baixando fotos: ${formatCount(photos.done + photos.failed)} de ${formatCount(photos.total)}`
                : `Fotos: ${formatCount(photos.done)} de ${formatCount(photos.total)} entraram`}
            </ProgressLabel>
            <ProgressValue />
          </Progress>
          {photosRunning ? (
            <p className="text-sm text-muted-foreground">
              Cada foto é baixada e otimizada no servidor. Pode sair desta página: o que faltar dá
              para continuar em Importações recentes.
            </p>
          ) : null}
        </div>
      ) : null}

      {photoError ? (
        <Alert variant="destructive">
          <CircleAlertIcon />
          <AlertTitle>As fotos pararam</AlertTitle>
          <AlertDescription className="flex flex-col items-start gap-2">
            {photoError}
            <Button type="button" variant="outline" size="sm" onClick={onRetryPhotos}>
              <ImagesIcon data-icon="inline-start" />
              Continuar fotos
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}

      {photoNotice ? (
        <Alert>
          <InfoIcon />
          <AlertTitle>Limite do plano</AlertTitle>
          <AlertDescription>{photoNotice}</AlertDescription>
        </Alert>
      ) : null}

      {errors.length > 0 ? (
        <section aria-labelledby="importacao-resultado-erros" className="flex flex-col gap-3">
          <h2 id="importacao-resultado-erros" className="text-base font-medium">
            Linhas com erro
          </h2>
          <ProblemList
            problems={errors}
            onDownload={onDownloadErrors}
            downloadLabel="Baixar CSV de erros"
          />
        </section>
      ) : null}

      {undone ? (
        <Alert>
          <InfoIcon />
          <AlertTitle>Importação desfeita</AlertTitle>
          <AlertDescription>
            O que esta planilha criou e ninguém alterou depois saiu do CRM.
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        {!undone && !photosRunning ? (
          <UndoImportButton jobId={jobId} onUndone={() => setUndone(true)} />
        ) : null}
        <Button type="button" variant="outline" onClick={onRestart}>
          <RotateCcwIcon data-icon="inline-start" />
          Importar outra planilha
        </Button>
        <Button render={<Link href={IMPORT_LIST_PATHS[kind]} />} nativeButton={false}>
          {LIST_LABELS[kind]}
        </Button>
      </div>
    </div>
  )
}

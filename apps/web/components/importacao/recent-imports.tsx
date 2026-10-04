"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { ImagesIcon } from "lucide-react"

import { IMPORT_KIND_LABELS } from "@workspace/core/import/fields"
import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemTitle,
} from "@workspace/ui/components/item"
import { Spinner } from "@workspace/ui/components/spinner"
import { toast } from "@workspace/ui/components/toast"

import { UndoImportButton } from "@/components/importacao/undo-import-button"
import { useImportPhotos } from "@/components/importacao/use-import-photos"
import { IMPORT_UNDO_DAYS } from "@/lib/importacao/constants"
import type { RecentImportJob } from "@/lib/importacao/jobs"

const DATE_FORMAT = new Intl.DateTimeFormat("pt-BR", {
  dateStyle: "short",
  timeStyle: "short",
  timeZone: "America/Sao_Paulo",
})

function formatCount(value: number) {
  return value.toLocaleString("pt-BR")
}

function ContinuePhotosButton({ jobId, pending }: { jobId: string; pending: number }) {
  const router = useRouter()
  const { state, run } = useImportPhotos()
  const running = state.status === "running"
  const progress = state.status === "idle" ? null : state.progress

  async function start() {
    const result = await run(jobId)

    if (result.status === "failed") {
      toast.add({ type: "error", title: result.error })
    } else if (result.status === "finished") {
      toast.add({
        type: "success",
        title: "Fotos baixadas",
        description:
          result.progress.failed > 0
            ? `${formatCount(result.progress.failed)} ${result.progress.failed === 1 ? "link não entrou" : "links não entraram"}. Veja o motivo baixando o CSV de erros ao importar de novo.`
            : undefined,
      })
    }

    router.refresh()
  }

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      disabled={running}
      onClick={() => void start()}
    >
      {running ? <Spinner data-icon="inline-start" /> : <ImagesIcon data-icon="inline-start" />}
      {running && progress
        ? `Fotos: ${formatCount(progress.done + progress.failed)} de ${formatCount(progress.total)}`
        : `Continuar fotos (${formatCount(pending)})`}
    </Button>
  )
}

/** Últimas importações com "Desfazer esta importação" (até 7 dias) e fotos pendentes. */
export function RecentImports({ jobs }: { jobs: RecentImportJob[] }) {
  if (jobs.length === 0) {
    return null
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Importações recentes</CardTitle>
        <CardDescription>
          Desfaça uma importação em até {IMPORT_UNDO_DAYS} dias. O que foi editado ou usado depois
          fica.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {jobs.map((job) => (
          <Item key={job.id} variant="outline" size="sm" className="flex-wrap">
            <ItemContent className="min-w-0">
              <ItemTitle className="flex flex-wrap items-center gap-2">
                {IMPORT_KIND_LABELS[job.kind]}
                {job.undoneAt ? <Badge variant="secondary">Desfeita</Badge> : null}
                {!job.finishedAt && !job.undoneAt ? (
                  <Badge variant="outline">Não concluída</Badge>
                ) : null}
              </ItemTitle>
              <ItemDescription>
                {DATE_FORMAT.format(new Date(job.createdAt))} · {job.createdByName} ·{" "}
                {formatCount(job.inserted)} {job.inserted === 1 ? "importado" : "importados"},{" "}
                {formatCount(job.updated)} {job.updated === 1 ? "atualizado" : "atualizados"},{" "}
                {formatCount(job.failed)} com erro
              </ItemDescription>
            </ItemContent>
            {job.canUndo || job.pendingPhotos > 0 ? (
              <ItemActions className="flex flex-wrap gap-2">
                {job.pendingPhotos > 0 ? (
                  <ContinuePhotosButton jobId={job.id} pending={job.pendingPhotos} />
                ) : null}
                {job.canUndo ? <UndoImportButton jobId={job.id} size="sm" /> : null}
              </ItemActions>
            ) : null}
          </Item>
        ))}
      </CardContent>
    </Card>
  )
}

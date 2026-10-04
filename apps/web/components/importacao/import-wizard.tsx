"use client"

import * as React from "react"
import { ChevronLeftIcon, ChevronRightIcon, CircleAlertIcon, UploadIcon } from "lucide-react"

import { IMPORT_KIND_LABELS, type ImportKind } from "@workspace/core/import/fields"
import {
  suggestColumnMapping,
  getMissingRequiredGroups,
  type ColumnMapping,
} from "@workspace/core/import/mapping"
import {
  buildImportErrorsCsv,
  chunkImportList,
  IMPORT_LOOKUP_ROWS,
  photoFailuresToProblems,
  photoLimitNotice,
  splitImportBatches,
  summarizeImport,
  type ImportRowOutcome,
  type ImportRowProblem,
  type ImportSummary,
} from "@workspace/core/import/report"
import {
  toLookupRow,
  validateImportRows,
  type ImportMember,
  type ImportPayload,
  type ImportValidation,
} from "@workspace/core/import/validate"
import { Alert, AlertDescription, AlertTitle } from "@workspace/ui/components/alert"
import { Button } from "@workspace/ui/components/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"
import { Progress, ProgressLabel, ProgressValue } from "@workspace/ui/components/progress"
import { Spinner } from "@workspace/ui/components/spinner"

import { FileStep } from "@/components/importacao/file-step"
import { ImportSteps, type ImportWizardStep } from "@/components/importacao/import-steps"
import { KindStep } from "@/components/importacao/kind-step"
import { MappingStep } from "@/components/importacao/mapping-step"
import { ResultStep } from "@/components/importacao/result-step"
import { ReviewStep, type ImportOptions } from "@/components/importacao/review-step"
import { useImportPhotos } from "@/components/importacao/use-import-photos"
import {
  findExistingImportRows,
  finishImportJob,
  importRowsBatch,
  startImportJob,
} from "@/lib/importacao/actions"
import { IMPORT_DEFAULT_TAG } from "@/lib/importacao/constants"
import { downloadCsv } from "@/lib/importacao/download"
import { resolveImportFeature } from "@/lib/importacao/features"
import type { SpreadsheetData } from "@/lib/importacao/read-spreadsheet"

type RunState =
  | { status: "idle" }
  | { status: "running"; done: number; total: number }
  | { status: "failed"; error: string; done: number; total: number }
  | {
      status: "finished"
      jobId: string
      summary: ImportSummary
      problems: ImportRowProblem[]
      hasPhotos: boolean
    }

type ActionOutcome<T> = { ok: true; data: T } | { ok: false; error: string }

const NETWORK_ERROR =
  "A conexão caiu no meio da importação. O que já foi gravado está salvo: tente de novo para continuar de onde parou."

const DEFAULT_OPTIONS: ImportOptions = {
  duplicateMode: "skip",
  legalBasis: "legitimate_interest",
  tag: IMPORT_DEFAULT_TAG,
}

const STEP_TEXT: Record<ImportWizardStep, { title: string; description: string }> = {
  kind: {
    title: "Escolha o tipo",
    description: "Clientes e contatos, leads ou imóveis.",
  },
  file: {
    title: "Envie a planilha",
    description: "Arquivo .csv ou .xlsx exportado do sistema antigo ou do Excel.",
  },
  mapping: {
    title: "Ligue as colunas aos campos",
    description: "Confira a sugestão e veja como as primeiras linhas vão entrar.",
  },
  review: {
    title: "Confira antes de gravar",
    description: "Nada foi gravado ainda. Veja o que entra, o que já existe e o que tem erro.",
  },
  import: {
    title: "Importação",
    description: "Gravando em lotes. Não feche esta página até terminar.",
  },
}

/** Chama a Server Action e tenta de novo quando a rede falha (o lote é idempotente). */
async function withRetry<T>(call: () => Promise<ActionOutcome<T>>): Promise<ActionOutcome<T>> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await call()
    } catch {
      await new Promise((resolve) => window.setTimeout(resolve, 1_000 * (attempt + 1)))
    }
  }

  return { ok: false, error: NETWORK_ERROR }
}

export function ImportWizard({ members }: { members: ImportMember[] }) {
  const [step, setStep] = React.useState<ImportWizardStep>("kind")
  const [kind, setKind] = React.useState<ImportKind>("clients")
  const [sheet, setSheet] = React.useState<SpreadsheetData | null>(null)
  const [mapping, setMapping] = React.useState<ColumnMapping>([])
  const [validation, setValidation] = React.useState<ImportValidation | null>(null)
  const [existingLines, setExistingLines] = React.useState<ReadonlySet<number>>(new Set())
  const [options, setOptions] = React.useState<ImportOptions>(DEFAULT_OPTIONS)
  const [checking, setChecking] = React.useState(false)
  const [checkError, setCheckError] = React.useState<string | null>(null)
  const [run, setRun] = React.useState<RunState>({ status: "idle" })
  const { state: photoState, run: runPhotos } = useImportPhotos()

  // Uma importação em andamento: o id e os lotes não mudam entre tentativas,
  // e o resultado de cada lote gravado fica guardado para retomar.
  const jobRef = React.useRef<{
    id: string
    batches: ImportPayload[][]
    outcomes: (ImportRowOutcome[] | undefined)[]
  } | null>(null)

  const running = run.status === "running" || photoState.status === "running"

  React.useEffect(() => {
    if (!running) {
      return
    }

    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault()
    }

    window.addEventListener("beforeunload", warn)
    return () => window.removeEventListener("beforeunload", warn)
  }, [running])

  const errors = React.useMemo<ImportRowProblem[]>(() => {
    if (!validation) {
      return []
    }

    return summarizeImport(validation, []).problems.filter((problem) => problem.status === "failed")
  }, [validation])

  const existingCount = React.useMemo(
    () => (validation ? validation.ready.filter((row) => existingLines.has(row.line)).length : 0),
    [validation, existingLines]
  )

  function resetRun() {
    jobRef.current = null
    setRun({ status: "idle" })
  }

  function chooseKind(next: ImportKind) {
    setKind(next)
    setValidation(null)
    resetRun()

    if (sheet) {
      setMapping(suggestColumnMapping(next, sheet.headers))
    }
  }

  function loadSheet(next: SpreadsheetData) {
    setSheet(next)
    setMapping(suggestColumnMapping(kind, next.headers))
    setValidation(null)
    resetRun()
  }

  function changeMapping(next: ColumnMapping) {
    setMapping(next)
    setValidation(null)
    resetRun()
  }

  function changeOptions(next: ImportOptions) {
    // Outro modo ou outra base legal é outra importação (o banco confere).
    setOptions(next)
    resetRun()
  }

  function downloadErrors(problems: readonly ImportRowProblem[]) {
    if (!sheet) {
      return
    }

    const cellsByLine = new Map(sheet.rows.map((row) => [row.line, row.cells]))
    const baseName = sheet.fileName.replace(/\.[^.]+$/, "").replace(/[^\p{L}\p{N}_-]+/gu, "-")

    downloadCsv(
      `${baseName || "planilha"}-erros.csv`,
      buildImportErrorsCsv(
        sheet.headers,
        problems.filter((problem) => problem.status === "failed"),
        cellsByLine
      )
    )
  }

  async function goToReview() {
    if (!sheet) {
      return
    }

    const next = validateImportRows(kind, sheet.rows, mapping, {
      members,
      resolveFeature: resolveImportFeature,
    })

    setValidation(next)
    resetRun()
    setChecking(true)
    setCheckError(null)

    const found = new Set<number>()

    for (const chunk of chunkImportList(next.ready, IMPORT_LOOKUP_ROWS)) {
      const result = await withRetry(() =>
        findExistingImportRows({ kind, rows: chunk.map((row) => toLookupRow(kind, row.payload)) })
      )

      if (!result.ok) {
        setCheckError(result.error)
        setChecking(false)
        return
      }

      for (const line of result.data) {
        found.add(line)
      }
    }

    setExistingLines(found)
    setChecking(false)
    setStep("review")
  }

  async function runImport() {
    if (!validation || validation.ready.length === 0 || running) {
      return
    }

    const job =
      jobRef.current ??
      (jobRef.current = {
        id: crypto.randomUUID(),
        batches: splitImportBatches(validation.ready),
        outcomes: [],
      })

    const total = job.batches.length
    const doneCount = () => job.outcomes.filter(Boolean).length

    setStep("import")
    setRun({ status: "running", done: doneCount(), total })

    const fail = (error: string) => setRun({ status: "failed", error, done: doneCount(), total })

    const started = await withRetry(() =>
      startImportJob({
        jobId: job.id,
        kind,
        duplicateMode: options.duplicateMode,
        totalRows: validation.totalRows,
        legalBasis: kind === "clients" ? options.legalBasis : null,
        tag: kind === "clients" ? options.tag.trim() || null : null,
      })
    )

    if (!started.ok) {
      fail(started.error)
      return
    }

    for (const [index, rows] of job.batches.entries()) {
      if (job.outcomes[index]) {
        continue
      }

      const result = await withRetry(() =>
        importRowsBatch({ jobId: job.id, batchIndex: index, rows })
      )

      if (!result.ok) {
        fail(result.error)
        return
      }

      job.outcomes[index] = result.data.outcomes
      setRun({ status: "running", done: doneCount(), total })
    }

    const finished = await withRetry(() =>
      finishImportJob({
        jobId: job.id,
        invalidRows: validation.rejected.length,
        fileDuplicates: validation.fileDuplicates.length,
      })
    )

    if (!finished.ok) {
      fail(finished.error)
      return
    }

    const { summary, problems } = summarizeImport(
      validation,
      job.outcomes.flatMap((outcomes) => outcomes ?? [])
    )
    const hasPhotos =
      kind === "properties" &&
      validation.ready.some(
        (row) => Array.isArray(row.payload.photo_urls) && row.payload.photo_urls.length > 0
      )

    setRun({ status: "finished", jobId: job.id, summary, problems, hasPhotos })

    if (hasPhotos) {
      await runPhotos(job.id)
    }
  }

  const photoProgress = photoState.status === "idle" ? null : photoState.progress
  const resultProblems = React.useMemo<ImportRowProblem[]>(() => {
    if (run.status !== "finished") {
      return []
    }

    const photoProblems = run.hasPhotos
      ? photoFailuresToProblems(photoProgress?.failures ?? [])
      : []

    return [...run.problems, ...photoProblems].sort((a, b) => a.line - b.line)
  }, [run, photoProgress])

  function restart() {
    setStep("kind")
    setSheet(null)
    setMapping([])
    setValidation(null)
    setExistingLines(new Set())
    setOptions(DEFAULT_OPTIONS)
    setCheckError(null)
    resetRun()
  }

  const missingGroups = sheet ? getMissingRequiredGroups(kind, mapping) : []
  const text = STEP_TEXT[step]
  const canGoBack = step !== "kind" && step !== "import"

  function goBack() {
    const previous: Partial<Record<ImportWizardStep, ImportWizardStep>> = {
      file: "kind",
      mapping: "file",
      review: "mapping",
    }

    setCheckError(null)
    setStep(previous[step] ?? "kind")
  }

  return (
    <div className="flex flex-col gap-4">
      <ImportSteps current={step} />

      <Card>
        <CardHeader>
          <CardTitle>{text.title}</CardTitle>
          <CardDescription>
            {step === "kind"
              ? text.description
              : `${IMPORT_KIND_LABELS[kind]} · ${text.description}`}
          </CardDescription>
        </CardHeader>

        <CardContent className="flex flex-col gap-4">
          {step === "kind" ? <KindStep value={kind} onChange={chooseKind} /> : null}

          {step === "file" ? <FileStep kind={kind} sheet={sheet} onLoaded={loadSheet} /> : null}

          {step === "mapping" && sheet ? (
            <MappingStep kind={kind} sheet={sheet} mapping={mapping} onChange={changeMapping} />
          ) : null}

          {step === "review" && validation ? (
            <ReviewStep
              validation={validation}
              existingCount={existingCount}
              errors={errors}
              options={options}
              onOptionsChange={changeOptions}
              onDownloadErrors={() => downloadErrors(errors)}
            />
          ) : null}

          {step === "import" && run.status === "finished" ? (
            <ResultStep
              kind={kind}
              jobId={run.jobId}
              summary={run.summary}
              problems={resultProblems}
              photos={run.hasPhotos ? photoProgress : null}
              photosRunning={run.hasPhotos && photoState.status === "running"}
              photoError={run.hasPhotos && photoState.status === "failed" ? photoState.error : null}
              photoNotice={run.hasPhotos ? photoLimitNotice(photoProgress?.failures ?? []) : null}
              onRetryPhotos={() => void runPhotos(run.jobId)}
              onDownloadErrors={() => downloadErrors(resultProblems)}
              onRestart={restart}
            />
          ) : null}

          {step === "import" && (run.status === "running" || run.status === "failed") ? (
            <div className="flex flex-col gap-4">
              <Progress value={run.total > 0 ? Math.round((run.done / run.total) * 100) : 0}>
                <ProgressLabel>
                  {run.status === "running"
                    ? `Gravando lote ${Math.min(run.done + 1, run.total)} de ${run.total}`
                    : `${run.done} de ${run.total} lotes gravados`}
                </ProgressLabel>
                <ProgressValue />
              </Progress>

              {run.status === "failed" ? (
                <Alert variant="destructive">
                  <CircleAlertIcon />
                  <AlertTitle>A importação parou</AlertTitle>
                  <AlertDescription>{run.error}</AlertDescription>
                </Alert>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Cada lote é gravado uma vez só: se a conexão cair, tentar de novo não duplica
                  nada.
                </p>
              )}
            </div>
          ) : null}

          {checkError ? (
            <Alert variant="destructive">
              <CircleAlertIcon />
              <AlertTitle>Não foi possível conferir a base</AlertTitle>
              <AlertDescription>{checkError}</AlertDescription>
            </Alert>
          ) : null}
        </CardContent>

        {step !== "import" || run.status === "failed" ? (
          <CardFooter className="flex flex-col-reverse gap-2 border-t sm:flex-row sm:justify-between">
            {canGoBack ? (
              <Button type="button" variant="outline" onClick={goBack} disabled={checking}>
                <ChevronLeftIcon data-icon="inline-start" />
                Voltar
              </Button>
            ) : run.status === "failed" ? (
              <Button type="button" variant="outline" onClick={() => setStep("review")}>
                <ChevronLeftIcon data-icon="inline-start" />
                Voltar à conferência
              </Button>
            ) : (
              <span className="hidden sm:block" />
            )}

            {step === "kind" ? (
              <Button type="button" onClick={() => setStep("file")}>
                Continuar
                <ChevronRightIcon data-icon="inline-end" />
              </Button>
            ) : null}

            {step === "file" ? (
              <Button type="button" disabled={!sheet} onClick={() => setStep("mapping")}>
                Continuar
                <ChevronRightIcon data-icon="inline-end" />
              </Button>
            ) : null}

            {step === "mapping" ? (
              <Button
                type="button"
                disabled={missingGroups.length > 0 || checking}
                onClick={() => void goToReview()}
              >
                {checking ? <Spinner data-icon="inline-start" /> : null}
                {checking ? "Conferindo a base…" : "Conferir linhas"}
                {checking ? null : <ChevronRightIcon data-icon="inline-end" />}
              </Button>
            ) : null}

            {step === "review" && validation ? (
              <Button
                type="button"
                disabled={validation.ready.length === 0}
                onClick={() => void runImport()}
              >
                <UploadIcon data-icon="inline-start" />
                Importar {validation.ready.length.toLocaleString("pt-BR")}{" "}
                {validation.ready.length === 1 ? "linha" : "linhas"}
              </Button>
            ) : null}

            {step === "import" && run.status === "failed" ? (
              <Button type="button" onClick={() => void runImport()}>
                Tentar de novo
              </Button>
            ) : null}
          </CardFooter>
        ) : null}
      </Card>
    </div>
  )
}

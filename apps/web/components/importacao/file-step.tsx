"use client"

import * as React from "react"
import { CircleAlertIcon, DownloadIcon, FileSpreadsheetIcon, UploadIcon } from "lucide-react"
import { cn } from "cn"

import { IMPORT_KIND_LABELS, type ImportKind } from "@workspace/core/import/fields"
import {
  buildImportTemplateCsv,
  IMPORT_MAX_ROWS,
  importTemplateFileName,
} from "@workspace/core/import/report"
import { Alert, AlertDescription, AlertTitle } from "@workspace/ui/components/alert"
import { Button } from "@workspace/ui/components/button"
import { Spinner } from "@workspace/ui/components/spinner"

import { IMPORT_ACCEPT } from "@/lib/importacao/constants"
import { downloadCsv } from "@/lib/importacao/download"
import {
  readSpreadsheet,
  SpreadsheetReadError,
  type SpreadsheetData,
} from "@/lib/importacao/read-spreadsheet"

export function describeSheetFormat(sheet: SpreadsheetData): string {
  if (sheet.format === "xlsx") {
    return "Excel (.xlsx), primeira aba"
  }

  const encoding = sheet.encoding === "windows-1252" ? "Windows-1252" : "UTF-8"
  const delimiter = sheet.delimiter === "," ? "vírgula" : "ponto e vírgula"

  return `CSV ${encoding}, separado por ${delimiter}`
}

export function FileStep({
  kind,
  sheet,
  onLoaded,
}: {
  kind: ImportKind
  sheet: SpreadsheetData | null
  onLoaded: (sheet: SpreadsheetData) => void
}) {
  const inputRef = React.useRef<HTMLInputElement>(null)
  const [reading, setReading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [dragging, setDragging] = React.useState(false)

  async function handleFile(file: File | undefined) {
    if (!file || reading) {
      return
    }

    setReading(true)
    setError(null)

    try {
      onLoaded(await readSpreadsheet(file))
    } catch (cause) {
      setError(
        cause instanceof SpreadsheetReadError
          ? cause.message
          : "Não foi possível ler o arquivo. Confira se ele abre no Excel e tente de novo."
      )
    } finally {
      setReading(false)
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3 rounded-lg border p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-col gap-1">
          <p className="text-sm font-medium">Modelo de planilha</p>
          <p className="text-sm text-muted-foreground">
            Pode usar a planilha do seu sistema atual: no próximo passo você liga cada coluna ao
            campo certo. Se preferir, comece pelo modelo de {IMPORT_KIND_LABELS[kind].toLowerCase()}
            .
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          className="w-full sm:w-auto"
          onClick={() => downloadCsv(importTemplateFileName(kind), buildImportTemplateCsv(kind))}
        >
          <DownloadIcon data-icon="inline-start" />
          Baixar modelo
        </Button>
      </div>

      <div
        className={cn(
          "flex flex-col items-center gap-3 rounded-lg border border-dashed px-4 py-8 text-center transition-colors",
          dragging && "border-primary bg-muted/50"
        )}
        onDragOver={(event) => {
          event.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault()
          setDragging(false)
          void handleFile(event.dataTransfer.files[0])
        }}
      >
        <FileSpreadsheetIcon aria-hidden="true" className="size-8 text-muted-foreground" />
        <div className="flex flex-col gap-1">
          <p className="text-sm font-medium">
            {sheet ? sheet.fileName : "Arraste a planilha para cá ou escolha o arquivo"}
          </p>
          <p className="text-sm text-muted-foreground">
            {sheet
              ? `${describeSheetFormat(sheet)} · ${sheet.rows.length.toLocaleString("pt-BR")} ${sheet.rows.length === 1 ? "linha" : "linhas"} · ${sheet.headers.length} colunas`
              : `.csv ou .xlsx, até 5 MB e ${IMPORT_MAX_ROWS.toLocaleString("pt-BR")} linhas. A primeira linha precisa ter os nomes das colunas.`}
          </p>
        </div>
        <input
          ref={inputRef}
          type="file"
          accept={IMPORT_ACCEPT}
          className="sr-only"
          tabIndex={-1}
          aria-hidden="true"
          onChange={(event) => {
            const file = event.target.files?.[0]
            event.target.value = ""
            void handleFile(file)
          }}
        />
        <Button
          type="button"
          variant={sheet ? "outline" : "default"}
          disabled={reading}
          onClick={() => inputRef.current?.click()}
        >
          {reading ? <Spinner data-icon="inline-start" /> : <UploadIcon data-icon="inline-start" />}
          {reading ? "Lendo o arquivo…" : sheet ? "Trocar arquivo" : "Escolher arquivo"}
        </Button>
      </div>

      {error ? (
        <Alert variant="destructive">
          <CircleAlertIcon />
          <AlertTitle>Não deu para usar este arquivo</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <p className="text-sm text-muted-foreground">
        O arquivo é lido aqui no seu navegador. Só as linhas conferidas vão para o CRM, e o registro
        da importação guarda apenas as contagens.
      </p>
    </div>
  )
}

"use client"

import * as React from "react"
import { CircleAlertIcon } from "lucide-react"

import { getImportFieldLabel, IMPORT_FIELDS, type ImportKind } from "@workspace/core/import/fields"
import {
  getMissingRequiredGroups,
  setColumnField,
  type ColumnMapping,
} from "@workspace/core/import/mapping"
import { IMPORT_PREVIEW_ROWS } from "@workspace/core/import/report"
import { Alert, AlertDescription, AlertTitle } from "@workspace/ui/components/alert"
import { Badge } from "@workspace/ui/components/badge"
import { NativeSelect, NativeSelectOption } from "@workspace/ui/components/native-select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@workspace/ui/components/table"

import type { SpreadsheetData } from "@/lib/importacao/read-spreadsheet"

function joinAlternatives(kind: ImportKind, group: readonly string[]) {
  const labels = group.map((key) => getImportFieldLabel(kind, key))

  if (labels.length === 1) {
    return labels[0]
  }

  return `${labels.slice(0, -1).join(", ")} ou ${labels.at(-1)}`
}

export function MappingStep({
  kind,
  sheet,
  mapping,
  onChange,
}: {
  kind: ImportKind
  sheet: SpreadsheetData
  mapping: ColumnMapping
  onChange: (mapping: ColumnMapping) => void
}) {
  const missing = getMissingRequiredGroups(kind, mapping)
  const previewRows = sheet.rows.slice(0, IMPORT_PREVIEW_ROWS)
  const mappedColumns = mapping
    .map((key, column) => ({ key, column }))
    .filter((item): item is { key: string; column: number } => item.key !== null)

  const examples = React.useMemo(
    () =>
      sheet.headers.map(
        (_, column) =>
          sheet.rows
            .slice(0, 50)
            .map((row) => row.cells[column]?.trim() ?? "")
            .find((value) => value.length > 0) ?? ""
      ),
    [sheet]
  )

  return (
    <div className="flex flex-col gap-6">
      {missing.length > 0 ? (
        <Alert variant="destructive">
          <CircleAlertIcon />
          <AlertTitle>Faltam colunas obrigatórias</AlertTitle>
          <AlertDescription>
            Ligue uma coluna a: {missing.map((group) => joinAlternatives(kind, group)).join("; ")}.
          </AlertDescription>
        </Alert>
      ) : null}

      <section aria-labelledby="importacao-colunas" className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <h2 id="importacao-colunas" className="text-base font-medium">
            Colunas da planilha
          </h2>
          <p className="text-sm text-muted-foreground">
            O CRM sugeriu os campos pelos nomes das colunas. Confira e ajuste; o que ficar em
            &quot;Não importar&quot; é ignorado.
          </p>
        </div>

        <ul className="flex flex-col divide-y rounded-lg border">
          {sheet.headers.map((header, column) => {
            const selectId = `importacao-coluna-${column}`
            const current = mapping[column] ?? null

            return (
              <li
                key={`${column}-${header}`}
                className="flex flex-col gap-2 px-3 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4"
              >
                <div className="flex min-w-0 flex-col gap-0.5">
                  <label htmlFor={selectId} className="truncate text-sm font-medium">
                    {header}
                  </label>
                  <span className="truncate text-xs text-muted-foreground">
                    {examples[column]
                      ? `Ex.: ${examples[column]}`
                      : "Coluna vazia nas primeiras linhas"}
                  </span>
                </div>
                <NativeSelect
                  id={selectId}
                  className="w-full sm:w-64 sm:shrink-0"
                  value={current ?? ""}
                  onChange={(event) =>
                    onChange(setColumnField(mapping, column, event.target.value || null))
                  }
                >
                  <NativeSelectOption value="">Não importar</NativeSelectOption>
                  {IMPORT_FIELDS[kind].map((field) => {
                    const usedElsewhere = mapping.some(
                      (key, index) => key === field.key && index !== column
                    )

                    return (
                      <NativeSelectOption key={field.key} value={field.key}>
                        {usedElsewhere ? `${field.label} (em outra coluna)` : field.label}
                      </NativeSelectOption>
                    )
                  })}
                </NativeSelect>
              </li>
            )
          })}
        </ul>
      </section>

      <section aria-labelledby="importacao-previa" className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <h2 id="importacao-previa" className="text-base font-medium">
            Prévia das {Math.min(IMPORT_PREVIEW_ROWS, sheet.rows.length)} primeiras linhas
          </h2>
          <p className="text-sm text-muted-foreground">
            Como os dados vão entrar em cada campo, antes da conferência.
          </p>
        </div>

        {mappedColumns.length === 0 ? (
          <p className="rounded-lg border px-3 py-6 text-center text-sm text-muted-foreground">
            Nenhuma coluna ligada a um campo ainda.
          </p>
        ) : (
          <div className="min-w-0 rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-16">Linha</TableHead>
                  {mappedColumns.map((item) => (
                    <TableHead key={item.column} className="whitespace-nowrap">
                      {getImportFieldLabel(kind, item.key)}
                      <Badge variant="outline" className="ms-2 font-normal">
                        {sheet.headers[item.column]}
                      </Badge>
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {previewRows.map((row) => (
                  <TableRow key={row.line}>
                    <TableCell className="text-muted-foreground tabular-nums">{row.line}</TableCell>
                    {mappedColumns.map((item) => (
                      <TableCell key={item.column} className="max-w-56 truncate">
                        {row.cells[item.column] || <span className="text-muted-foreground">—</span>}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>
    </div>
  )
}

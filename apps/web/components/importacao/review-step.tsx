"use client"

import { CircleAlertIcon, InfoIcon } from "lucide-react"

import type { ImportDuplicateMode, ImportKind } from "@workspace/core/import/fields"
import { describeImportWarning, type ImportRowProblem } from "@workspace/core/import/report"
import type { ImportValidation } from "@workspace/core/import/validate"
import { Alert, AlertDescription, AlertTitle } from "@workspace/ui/components/alert"
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
  FieldLegend,
  FieldSet,
  FieldTitle,
} from "@workspace/ui/components/field"
import { Input } from "@workspace/ui/components/input"
import { Item, ItemContent, ItemDescription, ItemTitle } from "@workspace/ui/components/item"
import { RadioGroup, RadioGroupItem } from "@workspace/ui/components/radio-group"

import { ProblemList } from "@/components/importacao/problem-list"
import {
  IMPORT_LEGAL_BASIS_LABELS,
  IMPORT_LEGAL_BASIS_VALUES,
  type ImportLegalBasis,
} from "@/lib/importacao/constants"

export type ImportOptions = {
  duplicateMode: ImportDuplicateMode
  legalBasis: ImportLegalBasis
  tag: string
}

const NOUNS: Record<ImportKind, { one: string; many: string }> = {
  clients: { one: "contato", many: "contatos" },
  leads: { one: "lead", many: "leads" },
  properties: { one: "imóvel", many: "imóveis" },
}

function formatCount(value: number) {
  return value.toLocaleString("pt-BR")
}

/** Avisos agrupados por mensagem, com as primeiras linhas de exemplo. */
function groupWarnings(validation: ImportValidation) {
  const groups = new Map<string, number[]>()

  for (const row of validation.ready) {
    for (const warning of row.warnings) {
      const message = describeImportWarning(validation.kind, warning)
      const lines = groups.get(message) ?? []

      if (lines.at(-1) !== row.line) {
        lines.push(row.line)
      }

      groups.set(message, lines)
    }
  }

  return [...groups.entries()].map(([message, lines]) => ({ message, lines }))
}

export function ReviewStep({
  validation,
  existingCount,
  errors,
  options,
  onOptionsChange,
  onDownloadErrors,
}: {
  validation: ImportValidation
  existingCount: number
  errors: readonly ImportRowProblem[]
  options: ImportOptions
  onOptionsChange: (options: ImportOptions) => void
  onDownloadErrors: () => void
}) {
  const kind = validation.kind
  const noun = NOUNS[kind]
  const ready = validation.ready.length
  const newRows = Math.max(ready - existingCount, 0)
  const warnings = groupWarnings(validation)
  const leadsWithoutEntryDate =
    kind === "leads" ? validation.ready.filter((row) => !row.payload.received_at).length : 0
  const photoLinks =
    kind === "properties"
      ? validation.ready.reduce(
          (sum, row) =>
            sum + (Array.isArray(row.payload.photo_urls) ? row.payload.photo_urls.length : 0),
          0
        )
      : 0

  const stats = [
    { label: "Linhas na planilha", value: validation.totalRows },
    { label: `${noun.many[0]?.toUpperCase()}${noun.many.slice(1)} novos`, value: newRows },
    { label: "Já existem no CRM", value: existingCount },
    { label: "Repetidas no próprio arquivo", value: validation.fileDuplicates.length },
    { label: "Com erro (não entram)", value: validation.rejected.length },
  ]

  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {stats.map((stat) => (
          <Item key={stat.label} variant="muted" size="sm">
            <ItemContent>
              <ItemTitle className="tabular-nums">{formatCount(stat.value)}</ItemTitle>
              <ItemDescription>{stat.label}</ItemDescription>
            </ItemContent>
          </Item>
        ))}
      </div>

      {leadsWithoutEntryDate > 0 ? (
        <Alert>
          <InfoIcon />
          <AlertTitle>
            {formatCount(leadsWithoutEntryDate)}{" "}
            {leadsWithoutEntryDate === 1 ? "lead sem data de entrada" : "leads sem data de entrada"}
          </AlertTitle>
          <AlertDescription>
            Sem a coluna &quot;Data de entrada&quot;, esses leads entram no funil mas não contam em
            Recebidos e Atendidos de nenhum mês, para não inflar o relatório deste mês. O prazo de
            primeiro contato nunca vale para lead importado.
          </AlertDescription>
        </Alert>
      ) : null}

      {photoLinks > 0 ? (
        <Alert>
          <InfoIcon />
          <AlertTitle>
            {formatCount(photoLinks)} {photoLinks === 1 ? "link de foto" : "links de foto"}
          </AlertTitle>
          <AlertDescription>
            Depois de gravar os imóveis, baixamos as fotos em lotes pequenos e otimizamos cada uma
            para até 2 MB. As fotos contam no limite do seu plano (fotos por imóvel e imóveis com
            foto); o que passar do limite fica de fora e aparece na lista de erros.
          </AlertDescription>
        </Alert>
      ) : null}

      {ready === 0 ? (
        <Alert variant="destructive">
          <CircleAlertIcon />
          <AlertTitle>Nenhuma linha pode ser importada</AlertTitle>
          <AlertDescription>
            Corrija as linhas com erro na planilha (o CSV abaixo lista todas) e envie o arquivo de
            novo.
          </AlertDescription>
        </Alert>
      ) : null}

      {ready > 0 ? (
        <FieldSet>
          <FieldLegend>O que fazer com quem já está no CRM</FieldLegend>
          <FieldDescription>
            {kind === "properties"
              ? "O imóvel é o mesmo quando tem o mesmo código de referência ou, sem código, o mesmo tipo, finalidade, título e endereço."
              : kind === "clients"
                ? "O contato é o mesmo quando tem o mesmo CPF ou CNPJ, e-mail ou telefone (só os números, com DDD)."
                : "O lead é o mesmo quando tem o mesmo telefone (só os números, com DDD) ou e-mail."}
          </FieldDescription>
          <RadioGroup
            value={options.duplicateMode}
            onValueChange={(value) =>
              onOptionsChange({ ...options, duplicateMode: value as ImportDuplicateMode })
            }
          >
            <FieldLabel htmlFor="importacao-duplicados-ignorar">
              <Field orientation="horizontal">
                <FieldContent>
                  <FieldTitle>Ignorar duplicados</FieldTitle>
                  <FieldDescription>
                    Recomendado. Quem já existe fica como está; importar o mesmo arquivo de novo não
                    cria nada repetido.
                  </FieldDescription>
                </FieldContent>
                <RadioGroupItem value="skip" id="importacao-duplicados-ignorar" />
              </Field>
            </FieldLabel>
            <FieldLabel htmlFor="importacao-duplicados-atualizar">
              <Field orientation="horizontal">
                <FieldContent>
                  <FieldTitle>Atualizar existentes</FieldTitle>
                  <FieldDescription>
                    As colunas preenchidas na planilha substituem o que está no CRM. Células vazias
                    não apagam nada.
                  </FieldDescription>
                </FieldContent>
                <RadioGroupItem value="update" id="importacao-duplicados-atualizar" />
              </Field>
            </FieldLabel>
          </RadioGroup>
        </FieldSet>
      ) : null}

      {kind === "clients" && ready > 0 ? (
        <FieldSet>
          <FieldLegend>Base legal para tratar os dados (LGPD)</FieldLegend>
          <FieldDescription>
            Vale para os contatos novos e para quem ainda não tinha base legal. Consentimento
            precisa ser registrado contato a contato, na ficha.
          </FieldDescription>
          <RadioGroup
            value={options.legalBasis}
            onValueChange={(value) =>
              onOptionsChange({ ...options, legalBasis: value as ImportLegalBasis })
            }
          >
            {IMPORT_LEGAL_BASIS_VALUES.map((value) => (
              <FieldLabel key={value} htmlFor={`importacao-base-legal-${value}`}>
                <Field orientation="horizontal">
                  <FieldContent>
                    <FieldTitle>{IMPORT_LEGAL_BASIS_LABELS[value].title}</FieldTitle>
                    <FieldDescription>{IMPORT_LEGAL_BASIS_LABELS[value].hint}</FieldDescription>
                  </FieldContent>
                  <RadioGroupItem value={value} id={`importacao-base-legal-${value}`} />
                </Field>
              </FieldLabel>
            ))}
          </RadioGroup>

          <Field>
            <FieldLabel htmlFor="importacao-etiqueta">Etiqueta dos contatos novos</FieldLabel>
            <Input
              id="importacao-etiqueta"
              value={options.tag}
              maxLength={40}
              onChange={(event) => onOptionsChange({ ...options, tag: event.target.value })}
              className="sm:max-w-xs"
            />
            <FieldDescription>
              Ajuda a achar quem veio desta planilha na lista de clientes. Deixe em branco para não
              marcar.
            </FieldDescription>
          </Field>
        </FieldSet>
      ) : null}

      {warnings.length > 0 ? (
        <Alert>
          <InfoIcon />
          <AlertTitle>Avisos (as linhas entram mesmo assim)</AlertTitle>
          <AlertDescription>
            <ul className="flex flex-col gap-1">
              {warnings.map((warning) => (
                <li key={warning.message}>
                  {warning.message}:{" "}
                  {warning.lines.length === 1
                    ? `linha ${warning.lines[0]}`
                    : `${formatCount(warning.lines.length)} linhas (${warning.lines.slice(0, 5).join(", ")}${warning.lines.length > 5 ? "…" : ""})`}
                </li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      ) : null}

      {errors.length > 0 ? (
        <section aria-labelledby="importacao-erros" className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <h2 id="importacao-erros" className="text-base font-medium">
              Linhas com erro
            </h2>
            <p className="text-sm text-muted-foreground">
              Estas linhas não entram. Baixe o CSV, corrija na planilha e importe só elas depois.
            </p>
          </div>
          <ProblemList
            problems={errors}
            onDownload={onDownloadErrors}
            downloadLabel="Baixar CSV de erros"
          />
        </section>
      ) : null}

      {validation.fileDuplicates.length > 0 ? (
        <p className="text-sm text-muted-foreground">
          {formatCount(validation.fileDuplicates.length)}{" "}
          {validation.fileDuplicates.length === 1 ? "linha repete" : "linhas repetem"} um {noun.one}{" "}
          que aparece antes no mesmo arquivo e{" "}
          {validation.fileDuplicates.length === 1 ? "será ignorada" : "serão ignoradas"}.
        </p>
      ) : null}
    </div>
  )
}

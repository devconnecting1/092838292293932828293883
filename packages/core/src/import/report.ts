/**
 * Textos e arquivos da importação: motivo de cada linha em pt-BR, modelo de
 * planilha, CSV de erros, lotes para a RPC e o resumo final.
 */

import { buildCsvDocument, type CsvValue } from "../reports/csv"
import { getImportFieldLabel, IMPORT_FIELDS, type ImportKind } from "./fields"
import type {
  ImportIssue,
  ImportPayload,
  ImportValidation,
  ImportWarning,
  PreparedImportRow,
} from "./validate"

/** Limites desta versão. */
export const IMPORT_MAX_ROWS = 5_000
export const IMPORT_MAX_BYTES = 5 * 1024 * 1024
export const IMPORT_PREVIEW_ROWS = 20
/**
 * Linhas por lote enviado à RPC (o banco aceita até 250). Medido no banco:
 * 194 contatos por lote levam até ~1,8 s, longe do statement_timeout de 8 s
 * do PostgREST.
 */
export const IMPORT_BATCH_ROWS = 200
/** Tamanho máximo de um lote serializado (Server Actions aceitam 1 MB por chamada). */
export const IMPORT_BATCH_MAX_BYTES = 600_000
/**
 * Linhas por consulta de duplicados na base (o banco aceita até 1.000). Imóvel
 * sem código compara endereço linha a linha, então a consulta fica menor.
 */
export const IMPORT_LOOKUP_ROWS = 500

// ---------------------------------------------------------------------------
// Motivos
// ---------------------------------------------------------------------------

/** Códigos que a RPC import_batch devolve por linha. */
export type ImportWriteCode =
  | "duplicate_in_base"
  | "saved_as_draft"
  | "required_name"
  | "required_contact"
  | "required_type"
  | "required_purpose"
  | "required_title"
  | "invalid_name"
  | "invalid_phone"
  | "invalid_email"
  | "invalid_document"
  | "invalid_member"
  | "invalid_value"
  | "duplicate_unique"
  | "billing_read_only"
  | "permission_denied"
  | "too_long"
  | "invalid_owner"
  | "invalid_owner_share"
  | "invalid_date"
  | "invalid_date_order"
  | "invalid_photo_link"
  | "write_failed"

const WRITE_MESSAGES: Record<ImportWriteCode, string> = {
  duplicate_in_base: "Já existe no CRM",
  saved_as_draft: "Entrou como rascunho: falta preço ou área para ficar ativo",
  required_name: "Nome vazio",
  required_contact: "Sem telefone, e-mail ou documento",
  required_type: "Tipo do imóvel vazio ou não reconhecido",
  required_purpose: "Finalidade vazia ou não reconhecida",
  required_title: "Título vazio",
  invalid_name: "Nome precisa ter de 2 a 120 caracteres",
  invalid_phone: "Telefone inválido: informe DDD e número",
  invalid_email: "E-mail inválido",
  invalid_document: "CPF ou CNPJ inválido",
  invalid_member: "O responsável não está ativo na equipe",
  invalid_value: "Algum valor não é aceito pelo CRM",
  duplicate_unique: "CPF, CNPJ ou código de referência já usado em outro cadastro",
  billing_read_only: "Assinatura em modo somente leitura",
  permission_denied: "Sem permissão para alterar este cadastro",
  too_long: "Texto maior que o permitido",
  invalid_owner: "Proprietário sem nome ou sem CPF/CNPJ, telefone ou e-mail válido",
  invalid_owner_share: "Percentuais dos proprietários precisam estar em todos e somar 100",
  invalid_date: "Data inválida (use DD/MM/AAAA, sem data futura)",
  invalid_date_order: "Data do 1º contato ou de ganho/perda antes da data de entrada",
  invalid_photo_link: "Link de foto inválido (use http:// ou https://, separados por |)",
  write_failed: "Não foi possível gravar esta linha",
}

export function describeWriteCode(code: string | undefined): string {
  if (code && code in WRITE_MESSAGES) {
    return WRITE_MESSAGES[code as ImportWriteCode]
  }

  return WRITE_MESSAGES.write_failed
}

export function describeImportIssue(kind: ImportKind, issue: ImportIssue): string {
  const label = issue.field ? getImportFieldLabel(kind, issue.field) : ""

  switch (issue.code) {
    case "required_name":
      return "Nome vazio"
    case "required_contact":
      return kind === "clients"
        ? "Sem telefone, WhatsApp, e-mail ou CPF/CNPJ"
        : "Sem telefone nem e-mail"
    case "required_type":
      return "Tipo do imóvel vazio ou não reconhecido"
    case "required_purpose":
      return "Finalidade vazia ou não reconhecida (use venda, locação ou venda e locação)"
    case "invalid_name":
      return "Nome precisa ter pelo menos 2 letras"
    case "invalid_phone":
      return `${label || "Telefone"} inválido: informe DDD e número`
    case "invalid_email":
      return "E-mail inválido"
    case "invalid_document":
      return "CPF ou CNPJ inválido"
    case "invalid_number":
      return `${label} não é um número válido`
    case "invalid_external_code":
      return "Código de referência com mais de 60 caracteres"
    case "invalid_date":
      return `${label || "Data"} inválida: use DD/MM/AAAA (hora opcional), sem data futura`
    case "invalid_date_order":
      return "Data do 1º contato ou de ganho/perda antes da data de entrada"
    case "invalid_owner":
      return "Proprietário sem nome ou sem CPF/CNPJ, telefone ou e-mail válido (vários: separe por |)"
    case "invalid_owner_share":
      return "Percentuais dos proprietários: informe em todos, de 0,01 a 100, somando 100"
    case "invalid_photo_link":
      return "Link de foto inválido: use endereços http:// ou https:// separados por |"
    case "duplicate_in_file":
      return issue.duplicateOf
        ? `Repetido no arquivo (igual à linha ${issue.duplicateOf})`
        : "Repetido no arquivo"
  }
}

export function describeImportWarning(kind: ImportKind, warning: ImportWarning): string {
  const label = warning.field ? getImportFieldLabel(kind, warning.field) : ""

  switch (warning.code) {
    case "member_not_found":
      return `${label}: ninguém da equipe com esse nome ou e-mail, ficou em branco`
    case "value_ignored":
      return `${label}: valor não reconhecido, ficou em branco`
    case "text_truncated":
      return `${label}: cortado no limite de ${(warning.limit ?? 0).toLocaleString("pt-BR")}`
    case "will_be_draft":
      return "Vai entrar como rascunho: falta preço ou área para ficar ativo"
  }
}

// ---------------------------------------------------------------------------
// Modelo de planilha
// ---------------------------------------------------------------------------

/** Cabeçalho com os nomes dos campos e uma linha de exemplo (CSV com `;` e BOM). */
export function buildImportTemplateCsv(kind: ImportKind): string {
  const fields = IMPORT_FIELDS[kind]

  return buildCsvDocument(
    fields.map((field) => field.label),
    [fields.map((field) => field.example)]
  )
}

export function importTemplateFileName(kind: ImportKind): string {
  const names: Record<ImportKind, string> = {
    clients: "modelo-importacao-clientes.csv",
    leads: "modelo-importacao-leads.csv",
    properties: "modelo-importacao-imoveis.csv",
  }

  return names[kind]
}

// ---------------------------------------------------------------------------
// Lotes
// ---------------------------------------------------------------------------

/**
 * Divide as linhas prontas em lotes de até `maxRows` linhas e `maxBytes` de
 * JSON. A divisão é determinística: reenviar o lote N manda as mesmas linhas.
 */
export function splitImportBatches(
  rows: readonly PreparedImportRow[],
  options: { maxRows?: number; maxBytes?: number } = {}
): ImportPayload[][] {
  const maxRows = options.maxRows ?? IMPORT_BATCH_ROWS
  const maxBytes = options.maxBytes ?? IMPORT_BATCH_MAX_BYTES
  const batches: ImportPayload[][] = []
  let current: ImportPayload[] = []
  let currentBytes = 2

  for (const row of rows) {
    const size = JSON.stringify(row.payload).length + 1

    if (current.length > 0 && (current.length >= maxRows || currentBytes + size > maxBytes)) {
      batches.push(current)
      current = []
      currentBytes = 2
    }

    current.push(row.payload)
    currentBytes += size
  }

  if (current.length > 0) {
    batches.push(current)
  }

  return batches
}

/** Divide qualquer lista em pedaços de tamanho fixo. */
export function chunkImportList<T>(items: readonly T[], size: number): T[][] {
  const chunks: T[][] = []

  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size))
  }

  return chunks
}

// ---------------------------------------------------------------------------
// Resultado
// ---------------------------------------------------------------------------

export type ImportRowStatus = "inserted" | "updated" | "skipped" | "failed"

export type ImportRowOutcome = { row: number; status: ImportRowStatus; code?: string }

export type ImportSummary = {
  totalRows: number
  inserted: number
  updated: number
  skipped: number
  failed: number
  /** Imóveis que entraram como rascunho por falta de preço ou área. */
  drafts: number
}

/** Motivo por linha que não foi importada nem atualizada (para a lista e o CSV). */
export type ImportRowProblem = {
  line: number
  status: "skipped" | "failed"
  reason: string
}

/** Junta a validação da tela com o que o banco devolveu em cada lote. */
export function summarizeImport(
  validation: ImportValidation,
  outcomes: readonly ImportRowOutcome[]
): { summary: ImportSummary; problems: ImportRowProblem[] } {
  const summary: ImportSummary = {
    totalRows: validation.totalRows,
    inserted: 0,
    updated: 0,
    skipped: validation.fileDuplicates.length,
    failed: validation.rejected.length,
    drafts: 0,
  }

  const problems: ImportRowProblem[] = [
    ...validation.rejected.map((row) => ({
      line: row.line,
      status: "failed" as const,
      reason: row.issues.map((issue) => describeImportIssue(validation.kind, issue)).join("; "),
    })),
    ...validation.fileDuplicates.map((row) => ({
      line: row.line,
      status: "skipped" as const,
      reason: row.issues.map((issue) => describeImportIssue(validation.kind, issue)).join("; "),
    })),
  ]

  for (const outcome of outcomes) {
    summary[outcome.status] += 1

    if (outcome.code === "saved_as_draft") {
      summary.drafts += 1
    }

    if (outcome.status === "skipped" || outcome.status === "failed") {
      problems.push({
        line: outcome.row,
        status: outcome.status,
        reason: describeWriteCode(outcome.code),
      })
    }
  }

  problems.sort((a, b) => a.line - b.line)

  return { summary, problems }
}

/**
 * CSV de erros para baixar: as colunas originais da planilha com "Linha" e
 * "Motivo" na frente, para a pessoa corrigir e importar de novo só essas.
 */
export function buildImportErrorsCsv(
  headers: readonly string[],
  problems: readonly ImportRowProblem[],
  cellsByLine: ReadonlyMap<number, readonly string[]>
): string {
  const rows: CsvValue[][] = problems.map((problem) => [
    problem.line,
    problem.reason,
    ...headers.map((_, column) => cellsByLine.get(problem.line)?.[column] ?? ""),
  ])

  return buildCsvDocument(["Linha", "Motivo", ...headers], rows)
}

// ---------------------------------------------------------------------------
// Fotos por link
// ---------------------------------------------------------------------------

/** Códigos de falha de um link de foto (RPC import_photos_status e servidor). */
export type ImportPhotoFailureCode =
  | "invalid_link"
  | "blocked_address"
  | "timeout"
  | "too_large"
  | "not_image"
  | "http_error"
  | "download_failed"
  | "optimize_failed"
  | "upload_failed"
  | "photo_limit_per_listing"
  | "photo_limit_property"
  | "listing_limit"
  | "billing_read_only"
  | "permission_denied"
  | "import_undone"

const PHOTO_FAILURE_MESSAGES: Record<ImportPhotoFailureCode, string> = {
  invalid_link: "link inválido",
  blocked_address: "endereço não permitido (só sites públicos na internet)",
  timeout: "o site demorou demais para responder",
  too_large: "arquivo grande demais (máximo de 15 MB antes de otimizar)",
  not_image: "o link não é uma foto JPG, PNG, WebP, GIF ou AVIF",
  http_error: "o site não entregou a foto (link quebrado ou protegido)",
  download_failed: "não foi possível baixar a foto",
  optimize_failed: "não foi possível otimizar a foto para até 2 MB",
  upload_failed: "não foi possível guardar a foto",
  photo_limit_per_listing: "passou do limite de fotos por imóvel do plano",
  photo_limit_property: "o imóvel já tem 20 fotos, o máximo",
  listing_limit: "o plano chegou ao limite de imóveis com foto; este imóvel ficou sem fotos",
  billing_read_only: "assinatura em modo somente leitura",
  permission_denied: "sem permissão para editar este imóvel",
  import_undone: "a importação foi desfeita",
}

export function describePhotoFailure(code: string | null | undefined): string {
  if (code && code in PHOTO_FAILURE_MESSAGES) {
    return PHOTO_FAILURE_MESSAGES[code as ImportPhotoFailureCode]
  }

  return PHOTO_FAILURE_MESSAGES.download_failed
}

export type ImportPhotoFailure = { row: number; position: number; code: string | null }

/**
 * Falhas de foto viram linhas da lista de problemas e do CSV de erros
 * ("Foto 2: o site demorou demais para responder"). Várias fotos da mesma
 * linha se juntam num motivo só.
 */
export function photoFailuresToProblems(
  failures: readonly ImportPhotoFailure[]
): ImportRowProblem[] {
  const byLine = new Map<number, string[]>()

  for (const failure of [...failures].sort((a, b) => a.row - b.row || a.position - b.position)) {
    const reasons = byLine.get(failure.row) ?? []
    reasons.push(`Foto ${failure.position + 1}: ${describePhotoFailure(failure.code)}`)
    byLine.set(failure.row, reasons)
  }

  return [...byLine.entries()].map(([line, reasons]) => ({
    line,
    status: "failed" as const,
    reason: reasons.join("; "),
  }))
}

/** Aviso único quando o plano barrou fotos (a tela mostra com o link para Assinatura). */
export function photoLimitNotice(failures: readonly ImportPhotoFailure[]): string | null {
  const listing = failures.filter((failure) => failure.code === "listing_limit").length
  const perListing = failures.filter((failure) => failure.code === "photo_limit_per_listing").length

  if (listing === 0 && perListing === 0) {
    return null
  }

  const parts: string[] = []

  if (listing > 0) {
    parts.push(
      `${listing.toLocaleString("pt-BR")} ${listing === 1 ? "foto ficou" : "fotos ficaram"} de fora porque o plano chegou ao limite de imóveis com foto`
    )
  }

  if (perListing > 0) {
    parts.push(
      `${perListing.toLocaleString("pt-BR")} ${perListing === 1 ? "foto passou" : "fotos passaram"} do limite de fotos por imóvel`
    )
  }

  return `${parts.join(" e ")}. Imóveis vendidos, alugados ou inativos não contam; para liberar vagas, atualize a situação desses imóveis ou mude de plano em Configurações > Assinatura.`
}

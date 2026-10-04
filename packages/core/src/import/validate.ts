/**
 * Validação da planilha antes de gravar: normaliza cada linha para o formato
 * das colunas do banco, lista os erros por linha e separa os duplicados dentro
 * do próprio arquivo (telefone só com dígitos e DDD, e-mail e CPF/CNPJ para
 * contatos; código de referência ou endereço para imóveis).
 *
 * A checagem contra a base existente é da RPC public.import_find_existing, e a
 * decisão final (ignorar ou atualizar) é da RPC public.import_batch.
 */

import { PROPERTY_TYPE_LABELS, type PropertyStatus, type PropertyType } from "../properties/enums"
import { isImportDateBefore, parseImportDateTime } from "./dates"
import type { ImportKind } from "./fields"
import { mapRowValues, type ColumnMapping } from "./mapping"
import {
  cleanLongText,
  cleanText,
  normalizeImportDocument,
  normalizeImportEmail,
  normalizeImportPhone,
  normalizeImportPostalCode,
  normalizeImportState,
  normalizeLabel,
  parseImportBoolean,
  parseImportDate,
  parseImportDecimal,
  parseImportInteger,
  phoneKey,
  splitImportList,
  truncate,
} from "./normalize"
import { parseImportOwners, type ImportOwnerPayload } from "./owners"
import { IMPORT_MAX_PHOTO_LINKS, parsePhotoLinks } from "./photo-links"
import {
  inferPropertyUsage,
  parseClientKind,
  parseClientSource,
  parseLeadInterest,
  parseLeadSource,
  parseLeadStage,
  parsePropertyStatus,
  parsePropertyType,
  parsePropertyUsage,
  parsePurpose,
} from "./values"

export type ImportIssueCode =
  | "required_name"
  | "required_contact"
  | "required_type"
  | "required_purpose"
  | "invalid_name"
  | "invalid_phone"
  | "invalid_email"
  | "invalid_document"
  | "invalid_number"
  | "invalid_external_code"
  | "invalid_date"
  | "invalid_date_order"
  | "invalid_owner"
  | "invalid_owner_share"
  | "invalid_photo_link"
  | "duplicate_in_file"

export type ImportWarningCode =
  "member_not_found" | "value_ignored" | "text_truncated" | "will_be_draft"

export type ImportIssue = { code: ImportIssueCode; field?: string; duplicateOf?: number }

export type ImportWarning = { code: ImportWarningCode; field?: string; limit?: number }

/** Linha lida do arquivo: `line` é o número da linha na planilha (cabeçalho = 1). */
export type ImportSourceRow = { line: number; cells: readonly string[] }

export type ImportMember = { id: string; name: string; email: string | null }

export type ImportPayloadValue = string | number | boolean | string[] | ImportOwnerPayload[]

/** Linha pronta para a RPC: colunas do banco + `row` (número da linha). */
export type ImportPayload = { row: number } & Record<string, ImportPayloadValue>

export type PreparedImportRow = {
  line: number
  payload: ImportPayload
  warnings: ImportWarning[]
}

export type RejectedImportRow = { line: number; issues: ImportIssue[] }

export type ImportValidation = {
  kind: ImportKind
  totalRows: number
  /** Linhas válidas e únicas no arquivo, na ordem da planilha. */
  ready: PreparedImportRow[]
  /** Linhas com erro (não serão enviadas). */
  rejected: RejectedImportRow[]
  /** Linhas iguais a uma anterior do mesmo arquivo (ignoradas). */
  fileDuplicates: RejectedImportRow[]
}

export type ImportValidationContext = {
  members: readonly ImportMember[]
  /** Traduz uma característica escrita na planilha para a chave do catálogo. */
  resolveFeature?: (label: string) => string
  /** Data de referência para "no futuro" (testes). */
  now?: Date
}

export const IMPORT_TEXT_LIMITS = {
  clientName: 200,
  leadName: 120,
  tradeName: 200,
  rg: 30,
  street: 200,
  streetNumber: 20,
  complement: 120,
  neighborhood: 120,
  city: 120,
  clientSource: 60,
  tag: 40,
  tags: 20,
  notes: 10_000,
  leadMessage: 2_000,
  leadTypology: 80,
  lostReason: 500,
  title: 200,
  description: 10_000,
  externalCode: 60,
  features: 50,
} as const

const MAX_MONEY = 999_999_999_999
const MAX_AREA = 9_999_999_999
const MAX_SMALLINT = 32_767

type RowResult = {
  payload: Record<string, ImportPayloadValue>
  issues: ImportIssue[]
  warnings: ImportWarning[]
  keys: string[]
}

class RowBuilder {
  readonly payload: Record<string, ImportPayloadValue> = {}
  readonly issues: ImportIssue[] = []
  readonly warnings: ImportWarning[] = []

  constructor(private readonly values: Record<string, string>) {}

  raw(key: string): string | null {
    return cleanText(this.values[key])
  }

  has(key: string): boolean {
    return this.raw(key) !== null
  }

  set(key: string, value: ImportPayloadValue | null | undefined) {
    if (value === null || value === undefined) {
      return
    }

    if (Array.isArray(value) && value.length === 0) {
      return
    }

    this.payload[key] = value
  }

  error(code: ImportIssueCode, field?: string) {
    this.issues.push(field ? { code, field } : { code })
  }

  warn(code: ImportWarningCode, field?: string, limit?: number) {
    const warning: ImportWarning = { code }

    if (field) warning.field = field
    if (limit !== undefined) warning.limit = limit

    this.warnings.push(warning)
  }

  /** Texto curto com limite: corta e avisa. */
  text(key: string, max: number, target = key): string | null {
    const value = this.raw(key)

    if (value === null) {
      return null
    }

    const result = truncate(value, max)

    if (result.truncated) {
      this.warn("text_truncated", key, max)
    }

    this.set(target, result.value)
    return result.value
  }

  longText(key: string, max: number, target = key): string | null {
    const value = cleanLongText(this.values[key])

    if (value === null) {
      return null
    }

    const result = truncate(value, max)

    if (result.truncated) {
      this.warn("text_truncated", key, max)
    }

    this.set(target, result.value)
    return result.value
  }

  phone(key: string): string | null {
    const result = normalizeImportPhone(this.values[key])

    if (!result.ok) {
      this.error("invalid_phone", key)
      return null
    }

    this.set(key, result.value)
    return result.value
  }

  email(key: string): string | null {
    const result = normalizeImportEmail(this.values[key])

    if (!result.ok) {
      this.error("invalid_email", key)
      return null
    }

    this.set(key, result.value)
    return result.value
  }

  postalCode(key: string) {
    const result = normalizeImportPostalCode(this.values[key])

    if (result.ok) {
      this.set(key, result.value)
    } else {
      this.warn("value_ignored", key)
    }
  }

  state(key: string) {
    const result = normalizeImportState(this.values[key])

    if (result.ok) {
      this.set(key, result.value)
    } else {
      this.warn("value_ignored", key)
    }
  }

  boolean(key: string) {
    const result = parseImportBoolean(this.values[key])

    if (result.ok) {
      this.set(key, result.value)
    } else {
      this.warn("value_ignored", key)
    }
  }

  /** Inteiro opcional: valor ruim é ignorado com aviso. */
  integer(key: string, min: number, max: number): number | null {
    const result = parseImportInteger(this.values[key])

    if (!result.ok || (result.value !== null && (result.value < min || result.value > max))) {
      this.warn("value_ignored", key)
      return null
    }

    this.set(key, result.value)
    return result.value
  }

  /** Valor numérico que decide status (preço e área): valor ruim é erro. */
  decimal(key: string, options: { max: number; allowZero?: boolean }): number | null {
    const result = parseImportDecimal(this.values[key])

    if (!result.ok || (result.value !== null && (result.value < 0 || result.value > options.max))) {
      this.error("invalid_number", key)
      return null
    }

    if (result.value === null || (result.value === 0 && !options.allowZero)) {
      return null
    }

    const rounded = Math.round(result.value * 100) / 100
    this.set(key, rounded)
    return rounded
  }

  member(key: string, resolve: (value: string) => string | null) {
    const value = this.raw(key)

    if (value === null) {
      return
    }

    const id = resolve(value)

    if (id) {
      this.set(key, id)
    } else {
      this.warn("member_not_found", key)
    }
  }

  result(keys: string[]): RowResult {
    return { payload: this.payload, issues: this.issues, warnings: this.warnings, keys }
  }
}

function memberResolver(members: readonly ImportMember[]) {
  const byEmail = new Map<string, string>()
  const byName = new Map<string, string | null>()

  for (const member of members) {
    if (member.email) {
      byEmail.set(member.email.trim().toLowerCase(), member.id)
    }

    const name = normalizeLabel(member.name)

    if (name) {
      // Nome repetido na equipe não identifica ninguém.
      byName.set(name, byName.has(name) ? null : member.id)
    }
  }

  return (value: string): string | null =>
    byEmail.get(value.trim().toLowerCase()) ?? byName.get(normalizeLabel(value)) ?? null
}

// ---------------------------------------------------------------------------
// Por tipo
// ---------------------------------------------------------------------------

function validateClient(
  builder: RowBuilder,
  resolveMember: (value: string) => string | null
): RowResult {
  const name = builder.text("name", IMPORT_TEXT_LIMITS.clientName)

  if (!name) {
    builder.error("required_name", "name")
  }

  const phone = builder.phone("phone")
  const whatsapp = builder.phone("whatsapp")
  const email = builder.email("email")
  const documentResult = normalizeImportDocument(builder.raw("document"))
  let kind = parseClientKind(builder.raw("kind")) ?? "pf"

  if (!documentResult.ok) {
    builder.error("invalid_document", "document")
  } else if (documentResult.value) {
    builder.set("document", documentResult.value.document)
    kind = documentResult.value.kind
  }

  if (!["phone", "whatsapp", "email", "document"].some((key) => builder.has(key))) {
    builder.error("required_contact")
  }

  builder.set("kind", kind)

  if (kind === "pj") {
    builder.text("trade_name", IMPORT_TEXT_LIMITS.tradeName)
  } else {
    builder.text("rg", IMPORT_TEXT_LIMITS.rg)

    const birth = parseImportDate(builder.raw("birth_date"))
    const today = new Date().toISOString().slice(0, 10)

    if (
      !birth.ok ||
      (birth.value !== null && (birth.value > today || birth.value < "1900-01-01"))
    ) {
      builder.warn("value_ignored", "birth_date")
    } else {
      builder.set("birth_date", birth.value)
    }
  }

  builder.postalCode("postal_code")
  builder.text("street", IMPORT_TEXT_LIMITS.street)
  builder.text("street_number", IMPORT_TEXT_LIMITS.streetNumber)
  builder.text("complement", IMPORT_TEXT_LIMITS.complement)
  builder.text("neighborhood", IMPORT_TEXT_LIMITS.neighborhood)
  builder.text("city", IMPORT_TEXT_LIMITS.city)
  builder.state("state")

  if (builder.has("source")) {
    builder.set("source", parseClientSource(builder.raw("source")))
  }

  const tags = splitImportList(builder.raw("tags")).map(
    (tag) => truncate(tag, IMPORT_TEXT_LIMITS.tag).value
  )

  if (tags.length > IMPORT_TEXT_LIMITS.tags) {
    builder.warn("text_truncated", "tags", IMPORT_TEXT_LIMITS.tags)
  }

  builder.set("tags", tags.slice(0, IMPORT_TEXT_LIMITS.tags))
  builder.member("assigned_to", resolveMember)
  builder.longText("notes", IMPORT_TEXT_LIMITS.notes)

  const keys: string[] = []
  const document = builder.payload.document

  if (typeof document === "string") keys.push(`doc:${document}`)
  if (email) keys.push(`email:${email}`)
  if (phone) keys.push(`phone:${phoneKey(phone)}`)
  if (whatsapp) keys.push(`phone:${phoneKey(whatsapp)}`)

  return builder.result(keys)
}

/**
 * Datas originais do lead: entrada, 1º contato e ganho/perda. 1º contato e
 * ganho/perda não vêm antes da entrada; data de ganho/perda só vale para lead
 * ganho ou perdido (nas outras etapas é ignorada com aviso).
 */
function validateLeadDates(builder: RowBuilder, now: Date) {
  const values: Partial<Record<"received_at" | "first_contact_at" | "closed_at", string>> = {}

  for (const key of ["received_at", "first_contact_at", "closed_at"] as const) {
    const result = parseImportDateTime(builder.raw(key), now)

    if (!result.ok) {
      builder.error("invalid_date", key)
    } else if (result.value) {
      values[key] = result.value
    }
  }

  const stage = builder.payload.stage

  if (values.closed_at && stage !== "won" && stage !== "lost") {
    delete values.closed_at
    builder.warn("value_ignored", "closed_at")
  }

  const received = values.received_at

  if (
    received &&
    ((values.first_contact_at && isImportDateBefore(values.first_contact_at, received)) ||
      (values.closed_at && isImportDateBefore(values.closed_at, received)))
  ) {
    builder.error("invalid_date_order", "received_at")
    return
  }

  builder.set("received_at", values.received_at)
  builder.set("first_contact_at", values.first_contact_at)
  builder.set("closed_at", values.closed_at)
}

function validateLead(
  builder: RowBuilder,
  resolveMember: (value: string) => string | null,
  now: Date
): RowResult {
  const name = builder.text("name", IMPORT_TEXT_LIMITS.leadName)

  if (!name) {
    builder.error("required_name", "name")
  } else if (name.length < 2) {
    builder.error("invalid_name", "name")
  }

  const phone = builder.phone("phone")
  const email = builder.email("email")

  if (!builder.has("phone") && !builder.has("email")) {
    builder.error("required_contact")
  }

  if (builder.has("stage")) {
    const stage = parseLeadStage(builder.raw("stage"))

    if (stage) {
      builder.set("stage", stage)
    } else {
      builder.warn("value_ignored", "stage")
    }
  }

  if (builder.payload.stage === "lost") {
    builder.text("lost_reason", IMPORT_TEXT_LIMITS.lostReason)
  }

  if (builder.has("interest")) {
    const interest = parseLeadInterest(builder.raw("interest"))

    if (interest) {
      builder.set("interest", interest)
    } else {
      builder.warn("value_ignored", "interest")
    }
  }

  builder.set("source", parseLeadSource(builder.raw("source")))
  builder.text("typology", IMPORT_TEXT_LIMITS.leadTypology)
  builder.longText("message", IMPORT_TEXT_LIMITS.leadMessage)
  builder.member("assigned_to", resolveMember)
  validateLeadDates(builder, now)

  const keys: string[] = []

  if (phone) keys.push(`phone:${phoneKey(phone)}`)
  if (email) keys.push(`email:${email}`)

  return builder.result(keys)
}

/** Preço exigido por finalidade e área exigida por tipo (CHECKs de properties). */
export function isPropertyComplete(values: {
  purpose: string
  type: PropertyType
  salePrice: number | null
  rentPrice: number | null
  livingArea: number | null
  lotArea: number | null
}): boolean {
  const priced =
    values.purpose === "sale"
      ? values.salePrice !== null
      : values.purpose === "rent"
        ? values.rentPrice !== null
        : values.salePrice !== null && values.rentPrice !== null

  const needsLot =
    values.type === "land" ||
    values.type === "farm" ||
    values.type === "ranch" ||
    values.type === "warehouse"

  return priced && (needsLot ? values.lotArea !== null : values.livingArea !== null)
}

/** Título gerado quando a planilha não traz: "Apartamento em Moema". */
export function buildPropertyTitle(
  type: PropertyType,
  place: { neighborhood?: string | null; city?: string | null }
): string {
  const where = place.neighborhood || place.city
  return truncate(
    where ? `${PROPERTY_TYPE_LABELS[type]} em ${where}` : PROPERTY_TYPE_LABELS[type],
    IMPORT_TEXT_LIMITS.title
  ).value
}

function validateProperty(
  builder: RowBuilder,
  resolveMember: (value: string) => string | null,
  resolveFeature: (label: string) => string
): RowResult {
  const code = builder.raw("external_code")

  if (code !== null) {
    if (code.length > IMPORT_TEXT_LIMITS.externalCode) {
      builder.error("invalid_external_code", "external_code")
    } else {
      builder.set("external_code", code)
    }
  }

  const type = parsePropertyType(builder.raw("type"))

  if (!type) {
    builder.error("required_type", "type")
  } else {
    builder.set("type", type)
  }

  const salePrice = builder.decimal("sale_price", { max: MAX_MONEY })
  const rentPrice = builder.decimal("rent_price", { max: MAX_MONEY })
  builder.decimal("condo_fee", { max: MAX_AREA, allowZero: true })
  builder.decimal("iptu_yearly", { max: MAX_AREA, allowZero: true })
  const livingArea = builder.decimal("living_area", { max: MAX_AREA })
  const lotArea = builder.decimal("lot_area", { max: MAX_MONEY })

  let purpose = parsePurpose(builder.raw("purpose"))

  if (!purpose) {
    if (builder.has("purpose")) {
      builder.error("required_purpose", "purpose")
    } else if (salePrice !== null && rentPrice !== null) {
      purpose = "sale_rent"
    } else if (salePrice !== null) {
      purpose = "sale"
    } else if (rentPrice !== null) {
      purpose = "rent"
    } else {
      builder.error("required_purpose", "purpose")
    }
  }

  builder.set("purpose", purpose)

  const neighborhood = builder.text("neighborhood", IMPORT_TEXT_LIMITS.neighborhood)
  const city = builder.text("city", IMPORT_TEXT_LIMITS.city)
  const street = builder.text("street", IMPORT_TEXT_LIMITS.street)
  const streetNumber = builder.text("street_number", IMPORT_TEXT_LIMITS.streetNumber)
  const complement = builder.text("complement", IMPORT_TEXT_LIMITS.complement)
  builder.postalCode("postal_code")
  builder.state("state")

  let title = builder.text("title", IMPORT_TEXT_LIMITS.title)

  if (!title && type) {
    title = buildPropertyTitle(type, { neighborhood, city })
    builder.set("title", title)
    builder.set("title_generated", true)
  }

  builder.longText("description", IMPORT_TEXT_LIMITS.description)

  let status: PropertyStatus | null = null

  if (builder.has("status")) {
    status = parsePropertyStatus(builder.raw("status"))

    if (status) {
      builder.set("status", status)
    } else {
      builder.warn("value_ignored", "status")
    }
  }

  const usage = parsePropertyUsage(builder.raw("usage"))

  if (builder.has("usage") && !usage) {
    builder.warn("value_ignored", "usage")
  }

  if (type) {
    builder.set("usage", usage ?? inferPropertyUsage(type))
  }

  const bedrooms = builder.integer("bedrooms", 0, MAX_SMALLINT)
  const suites = builder.integer("suites", 0, MAX_SMALLINT)

  if (suites !== null && bedrooms !== null && suites > bedrooms) {
    delete builder.payload.suites
    builder.warn("value_ignored", "suites")
  }

  builder.integer("bathrooms", 0, MAX_SMALLINT)
  builder.integer("parking_spaces", 0, MAX_SMALLINT)
  builder.integer("floor", 0, MAX_SMALLINT)
  builder.integer("total_floors", 0, MAX_SMALLINT)
  builder.integer("year_built", 1500, 2200)

  const features = splitImportList(builder.raw("features")).map(resolveFeature)

  if (features.length > IMPORT_TEXT_LIMITS.features) {
    builder.warn("text_truncated", "features", IMPORT_TEXT_LIMITS.features)
  }

  builder.set("features", [...new Set(features)].slice(0, IMPORT_TEXT_LIMITS.features))
  builder.boolean("furnished")
  builder.boolean("accepts_pets")
  builder.boolean("accepts_exchange")
  builder.member("broker_id", resolveMember)
  builder.member("captured_by", resolveMember)

  const owners = parseImportOwners({
    name: builder.raw("owner_name"),
    document: builder.raw("owner_document"),
    phone: builder.raw("owner_phone"),
    email: builder.raw("owner_email"),
    share: builder.raw("owner_share"),
  })

  if (owners.issue) {
    builder.error(
      owners.issue,
      owners.issue === "invalid_owner_share" ? "owner_share" : "owner_name"
    )
  } else {
    builder.set("owners", owners.owners)
  }

  const photos = parsePhotoLinks(builder.raw("photo_urls"))

  if (photos.invalid > 0) {
    builder.error("invalid_photo_link", "photo_urls")
  } else {
    if (photos.truncated) {
      builder.warn("text_truncated", "photo_urls", IMPORT_MAX_PHOTO_LINKS)
    }

    builder.set("photo_urls", photos.urls)
  }

  if (
    type &&
    purpose &&
    (status ?? "active") !== "draft" &&
    !isPropertyComplete({ purpose, type, salePrice, rentPrice, livingArea, lotArea })
  ) {
    builder.warn("will_be_draft")
  }

  const keys: string[] = []

  if (typeof builder.payload.external_code === "string") {
    keys.push(`code:${builder.payload.external_code}`)
  } else if (type && purpose && title) {
    keys.push(
      [
        "fp",
        type,
        purpose,
        title,
        street ?? "",
        streetNumber ?? "",
        complement ?? "",
        neighborhood ?? "",
        city ?? "",
      ]
        .map((part) => part.toLowerCase())
        .join("|")
    )
  }

  return builder.result(keys)
}

// ---------------------------------------------------------------------------
// Planilha inteira
// ---------------------------------------------------------------------------

export function validateImportRows(
  kind: ImportKind,
  rows: readonly ImportSourceRow[],
  mapping: ColumnMapping,
  context: ImportValidationContext
): ImportValidation {
  const resolveMember = memberResolver(context.members)
  const resolveFeature = context.resolveFeature ?? ((label: string) => label)
  const now = context.now ?? new Date()
  const firstLineByKey = new Map<string, number>()
  const validation: ImportValidation = {
    kind,
    totalRows: rows.length,
    ready: [],
    rejected: [],
    fileDuplicates: [],
  }

  for (const row of rows) {
    const builder = new RowBuilder(mapRowValues(mapping, row.cells))
    const result =
      kind === "clients"
        ? validateClient(builder, resolveMember)
        : kind === "leads"
          ? validateLead(builder, resolveMember, now)
          : validateProperty(builder, resolveMember, resolveFeature)

    if (result.issues.length > 0) {
      validation.rejected.push({ line: row.line, issues: result.issues })
      continue
    }

    const duplicateOf = result.keys
      .map((key) => firstLineByKey.get(key))
      .find((line): line is number => line !== undefined)

    if (duplicateOf !== undefined) {
      validation.fileDuplicates.push({
        line: row.line,
        issues: [{ code: "duplicate_in_file", duplicateOf }],
      })
      continue
    }

    for (const key of result.keys) {
      firstLineByKey.set(key, row.line)
    }

    validation.ready.push({
      line: row.line,
      payload: { ...result.payload, row: row.line },
      warnings: result.warnings,
    })
  }

  return validation
}

/** Só os campos que a busca de duplicados na base usa (payload menor). */
export function toLookupRow(kind: ImportKind, payload: ImportPayload): ImportPayload {
  const keys =
    kind === "clients"
      ? ["document", "email", "phone", "whatsapp"]
      : kind === "leads"
        ? ["email", "phone"]
        : [
            "external_code",
            "type",
            "purpose",
            "title",
            "street",
            "street_number",
            "complement",
            "neighborhood",
            "city",
          ]

  const lookup: ImportPayload = { row: payload.row }

  for (const key of keys) {
    const value = payload[key]

    if (value !== undefined) {
      lookup[key] = value
    }
  }

  return lookup
}

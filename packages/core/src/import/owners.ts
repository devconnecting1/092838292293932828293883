/**
 * Proprietários do imóvel na planilha. Módulo puro.
 *
 * Cada coluna de proprietário (nome, CPF/CNPJ, telefone, e-mail, percentual)
 * aceita vários valores separados por `|`, na mesma ordem:
 * "Maria | João" + "60 | 40" = Maria com 60% e João com 40%.
 * Percentual é opcional; quando informado, vai em todos e soma 100.
 */

import {
  cleanText,
  normalizeImportDocument,
  normalizeImportEmail,
  normalizeImportPhone,
  truncate,
  type NormalizedResult,
} from "./normalize"

/** Até quantos proprietários por imóvel (o banco confere o mesmo teto). */
export const IMPORT_MAX_OWNERS = 10

/** Diferença aceita na soma dos percentuais (arredondamento de 33,33 + 33,33 + 33,34). */
export const OWNER_SHARE_TOLERANCE = 0.01

export const OWNER_NAME_MAX = 200

/** Proprietário como vai para a RPC import_batch (chave `owners`). */
export type ImportOwnerPayload = {
  name: string
  document?: string
  phone?: string
  email?: string
  share_percent?: number
}

export type OwnerColumns = {
  name: string | null | undefined
  document: string | null | undefined
  phone: string | null | undefined
  email: string | null | undefined
  share: string | null | undefined
}

export type OwnerIssue = "invalid_owner" | "invalid_owner_share"

export type ParsedOwners = { owners: ImportOwnerPayload[]; issue: OwnerIssue | null }

/** Divide a célula pelos proprietários (`|`). Vazio = lista vazia. */
export function splitOwnerCell(raw: string | null | undefined): string[] {
  const text = cleanText(raw)

  if (!text) {
    return []
  }

  return text.split("|").map((part) => part.trim())
}

/**
 * "50", "50%", "33,33", "33.33 %" → número entre 0,01 e 100 com até 2 casas.
 * Vazio vira `null`.
 */
export function parseOwnerShare(raw: string | null | undefined): NormalizedResult<number> {
  const text = cleanText(raw)

  if (!text) {
    return { ok: true, value: null }
  }

  const compact = text.replace(/\s|%/g, "").replace(",", ".")

  if (!/^\d{1,3}(\.\d{1,2})?$/.test(compact)) {
    return { ok: false }
  }

  const value = Number(compact)

  return value >= 0.01 && value <= 100 ? { ok: true, value } : { ok: false }
}

/** Percentuais informados: todos ou nenhum, e somando 100. */
export function ownerSharesAreValid(shares: readonly (number | null)[]): boolean {
  const given = shares.filter((share): share is number => share !== null)

  if (given.length === 0) {
    return true
  }

  if (given.length !== shares.length) {
    return false
  }

  const total = given.reduce((sum, share) => sum + share, 0)

  return Math.abs(total - 100) <= OWNER_SHARE_TOLERANCE
}

/**
 * Lê as colunas de proprietário de uma linha. Cada proprietário precisa de
 * nome e de pelo menos um contato (CPF/CNPJ, telefone ou e-mail): é assim que
 * a importação encontra o cliente já cadastrado em vez de duplicar.
 */
export function parseImportOwners(columns: OwnerColumns): ParsedOwners {
  const names = splitOwnerCell(columns.name)
  const documents = splitOwnerCell(columns.document)
  const phones = splitOwnerCell(columns.phone)
  const emails = splitOwnerCell(columns.email)
  const shares = splitOwnerCell(columns.share)
  const count = Math.max(
    names.length,
    documents.length,
    phones.length,
    emails.length,
    shares.length
  )

  if (count === 0) {
    return { owners: [], issue: null }
  }

  if (count > IMPORT_MAX_OWNERS) {
    return { owners: [], issue: "invalid_owner" }
  }

  const owners: ImportOwnerPayload[] = []
  const parsedShares: (number | null)[] = []

  for (let index = 0; index < count; index += 1) {
    const name = cleanText(names[index])
    const document = normalizeImportDocument(documents[index])
    const phone = normalizeImportPhone(phones[index])
    const email = normalizeImportEmail(emails[index])
    const share = parseOwnerShare(shares[index])

    if (!share.ok) {
      return { owners: [], issue: "invalid_owner_share" }
    }

    if (!name || !document.ok || !phone.ok || !email.ok) {
      return { owners: [], issue: "invalid_owner" }
    }

    if (!document.value && !phone.value && !email.value) {
      return { owners: [], issue: "invalid_owner" }
    }

    const owner: ImportOwnerPayload = { name: truncate(name, OWNER_NAME_MAX).value }

    if (document.value) owner.document = document.value.document
    if (phone.value) owner.phone = phone.value
    if (email.value) owner.email = email.value
    if (share.value !== null) owner.share_percent = share.value

    owners.push(owner)
    parsedShares.push(share.value)
  }

  if (!ownerSharesAreValid(parsedShares)) {
    return { owners: [], issue: "invalid_owner_share" }
  }

  return { owners, issue: null }
}

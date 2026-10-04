// Conferência, no servidor, do arquivo que o navegador enviou por URL assinada.
// O navegador não tem sessão para o Storage: gera-se um token de envio por
// caminho e, ao confirmar, o servidor lê o tamanho e o tipo gravados no bucket
// (não os informados pelo navegador) antes de registrar no banco.

import { formatBytes } from "./format"

/** Tipo de conteúdo esperado para cada extensão usada nos caminhos do Storage. */
const TYPE_BY_EXTENSION: Readonly<Record<string, string>> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  pdf: "application/pdf",
}

/** `image/jpeg; charset=binary` → `image/jpeg`. Vazio quando não há tipo. */
export function normalizeContentType(value: string | null | undefined): string {
  return (value ?? "").split(";")[0]?.trim().toLowerCase() ?? ""
}

/** Extensão do último segmento do caminho (`org/x/uuid.JPG` → `jpg`). */
export function extensionOfPath(path: string): string {
  const fileName = path.slice(path.lastIndexOf("/") + 1)
  const dot = fileName.lastIndexOf(".")
  return dot > 0 ? fileName.slice(dot + 1).toLowerCase() : ""
}

/** Tipo esperado pela extensão do caminho; `null` se a extensão não é conhecida. */
export function expectedContentTypeForPath(path: string): string | null {
  return TYPE_BY_EXTENSION[extensionOfPath(path)] ?? null
}

export type UploadedObjectInfo = {
  size?: number | null
  contentType?: string | null
}

export type UploadedObjectRules = {
  allowedTypes: readonly string[]
  maxBytes: number
  /** Tipo que o arquivo precisa ter (ex.: o informado ao pedir o envio ou o da extensão). */
  expectedType?: string | null
}

export type UploadedObjectProblem =
  "missing" | "empty" | "too_large" | "type_not_allowed" | "type_mismatch"

export type UploadedObjectCheck =
  { ok: true; size: number; contentType: string } | { ok: false; problem: UploadedObjectProblem }

/**
 * Confere tamanho e tipo do objeto gravado no bucket. `info` nulo = o arquivo
 * não está no bucket (envio não concluído ou caminho errado).
 */
export function checkUploadedObject(
  info: UploadedObjectInfo | null | undefined,
  rules: UploadedObjectRules
): UploadedObjectCheck {
  if (!info) return { ok: false, problem: "missing" }

  const size = typeof info.size === "number" && Number.isFinite(info.size) ? info.size : 0
  if (size <= 0) return { ok: false, problem: "empty" }
  if (size > rules.maxBytes) return { ok: false, problem: "too_large" }

  const contentType = normalizeContentType(info.contentType)
  const allowed = rules.allowedTypes.map((type) => normalizeContentType(type))
  if (!contentType || !allowed.includes(contentType)) {
    return { ok: false, problem: "type_not_allowed" }
  }

  if (rules.expectedType !== undefined) {
    const expected = normalizeContentType(rules.expectedType)
    if (!expected || expected !== contentType) return { ok: false, problem: "type_mismatch" }
  }

  return { ok: true, size, contentType }
}

/**
 * Mensagem em pt-BR para o problema encontrado.
 * @param formats ex.: "JPG ou WebP"; `maxBytes` vira "2 MB".
 */
export function uploadedObjectProblemMessage(
  problem: UploadedObjectProblem,
  { formats, maxBytes }: { formats: string; maxBytes: number }
): string {
  switch (problem) {
    case "missing":
      return "O arquivo não chegou ao armazenamento. Verifique a conexão e envie de novo."
    case "empty":
      return "O arquivo chegou vazio. Envie de novo."
    case "too_large":
      return `O arquivo passa de ${formatBytes(maxBytes)}.`
    case "type_not_allowed":
    case "type_mismatch":
      return `Formato não aceito. Envie ${formats}.`
  }
}

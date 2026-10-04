// Convenção de caminhos da miniatura: mesmo nome base da foto principal com o
// sufixo `__thumb.webp`, na mesma pasta. Não há coluna no banco: o caminho da
// miniatura é sempre derivado do caminho (ou da URL) da principal.

import { IMAGE_PRESETS } from "./image-sizing"

export const THUMB_SUFFIX = "__thumb.webp"

/** Larguras declaradas no `srcset` (lado maior dos presets). */
export const THUMB_WIDTH = IMAGE_PRESETS.propertyThumb.maxDimension
export const MAIN_PHOTO_WIDTH = IMAGE_PRESETS.propertyPhoto.maxDimension

function thumbFileName(fileName: string) {
  if (fileName.endsWith(THUMB_SUFFIX)) return fileName
  const lastDot = fileName.lastIndexOf(".")
  const base = lastDot > 0 ? fileName.slice(0, lastDot) : fileName
  return `${base}${THUMB_SUFFIX}`
}

export function isThumbPath(path: string) {
  return path.endsWith(THUMB_SUFFIX)
}

/**
 * `org/properties/imovel/uuid.jpg` → `org/properties/imovel/uuid__thumb.webp`.
 * Idempotente para caminhos que já são de miniatura.
 */
export function thumbPathFor(path: string): string {
  const slash = path.lastIndexOf("/")
  const fileName = path.slice(slash + 1)
  if (!fileName) {
    throw new Error("Caminho de arquivo sem nome.")
  }
  return `${path.slice(0, slash + 1)}${thumbFileName(fileName)}`
}

/**
 * URL pública da miniatura a partir da URL da principal (preserva query e
 * fragmento). `null` quando não há URL ou ela não termina em arquivo.
 */
export function getThumbUrl(url: string | null | undefined): string | null {
  if (!url) return null
  const match = /^([^?#]*)(.*)$/s.exec(url)
  const pathPart = match?.[1] ?? ""
  const rest = match?.[2] ?? ""
  const slash = pathPart.lastIndexOf("/")
  const fileName = pathPart.slice(slash + 1)
  if (!fileName) return null
  return `${pathPart.slice(0, slash + 1)}${thumbFileName(fileName)}${rest}`
}

/** `srcset` com a miniatura e a principal (o navegador escolhe pelo `sizes`). */
export function buildPhotoSrcSet(mainUrl: string | null | undefined): string | undefined {
  const thumbUrl = getThumbUrl(mainUrl)
  if (!mainUrl || !thumbUrl) return undefined
  return `${thumbUrl} ${THUMB_WIDTH}w, ${mainUrl} ${MAIN_PHOTO_WIDTH}w`
}

/** Troca (ou acrescenta) a extensão de um nome de arquivo: `RG frente.png` → `RG frente.jpg`. */
export function replaceExtension(fileName: string, extension: string) {
  const lastDot = fileName.lastIndexOf(".")
  const base = lastDot > 0 ? fileName.slice(0, lastDot) : fileName
  return `${base}.${extension.replace(/^\.+/, "")}`
}

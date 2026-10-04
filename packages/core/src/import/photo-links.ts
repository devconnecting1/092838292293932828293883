/**
 * Links de fotos na planilha de imóveis e as regras de segurança do download.
 * Módulo puro (sem rede): quem baixa é o servidor do app
 * (apps/web/lib/importacao/photo-download.ts), que usa estas funções para
 * recusar link inválido e endereço interno (proteção contra SSRF).
 */

import { cleanText } from "./normalize"

/** Teto por imóvel (o mesmo do gatilho private.enforce_property_photo_limit). */
export const IMPORT_MAX_PHOTO_LINKS = 20

export const PHOTO_LINK_MAX_LENGTH = 2000

/** Tamanho máximo do arquivo baixado, antes de otimizar. */
export const PHOTO_DOWNLOAD_MAX_BYTES = 15 * 1024 * 1024

/** Tempo máximo de cada download (conexão + resposta inteira). */
export const PHOTO_DOWNLOAD_TIMEOUT_MS = 12_000

/** Redirecionamentos seguidos (cada destino é conferido de novo). */
export const PHOTO_DOWNLOAD_MAX_REDIRECTS = 3

export type ParsedPhotoLinks = {
  urls: string[]
  /** Quantos links não são http(s) válidos. */
  invalid: number
  /** A célula tinha mais links que o teto por imóvel. */
  truncated: boolean
}

/**
 * Célula com um ou mais links separados por `|` (ou quebra de linha). Repetidos
 * saem; link inválido é contado; acima de `max` corta e avisa.
 */
export function parsePhotoLinks(
  raw: string | null | undefined,
  max: number = IMPORT_MAX_PHOTO_LINKS
): ParsedPhotoLinks {
  const text = cleanText(raw?.replace(/\r?\n/g, " | "))

  if (!text) {
    return { urls: [], invalid: 0, truncated: false }
  }

  const urls: string[] = []
  const seen = new Set<string>()
  let invalid = 0

  for (const part of text.split("|")) {
    const candidate = part.trim()

    if (!candidate) {
      continue
    }

    const url = normalizePhotoUrl(candidate)

    if (!url) {
      invalid += 1
      continue
    }

    if (!seen.has(url)) {
      seen.add(url)
      urls.push(url)
    }
  }

  return { urls: urls.slice(0, max), invalid, truncated: urls.length > max }
}

/** Link http(s) absoluto, sem usuário/senha, até 2.000 caracteres. `null` se não servir. */
export function normalizePhotoUrl(raw: string): string | null {
  const text = raw.trim()

  if (text.length === 0 || text.length > PHOTO_LINK_MAX_LENGTH || /[\s\p{Cc}]/u.test(text)) {
    return null
  }

  let url: URL

  try {
    url = new URL(text)
  } catch {
    return null
  }

  if ((url.protocol !== "http:" && url.protocol !== "https:") || !url.hostname) {
    return null
  }

  if (url.username || url.password) {
    return null
  }

  const href = url.toString()

  return href.length <= PHOTO_LINK_MAX_LENGTH ? href : null
}

// ---------------------------------------------------------------------------
// Endereços
// ---------------------------------------------------------------------------

function parseIpv4(address: string): number[] | null {
  const parts = address.split(".")

  if (parts.length !== 4) {
    return null
  }

  const octets = parts.map((part) => (/^\d{1,3}$/.test(part) ? Number(part) : Number.NaN))

  return octets.every((octet) => Number.isInteger(octet) && octet >= 0 && octet <= 255)
    ? octets
    : null
}

function isPublicIpv4(octets: readonly number[]): boolean {
  const [a = 0, b = 0, c = 0] = octets

  if (a === 0 || a === 10 || a === 127) return false // "esta rede", privada, loopback
  if (a === 100 && b >= 64 && b <= 127) return false // CGNAT
  if (a === 169 && b === 254) return false // link-local (metadados de nuvem)
  if (a === 172 && b >= 16 && b <= 31) return false // privada
  if (a === 192 && b === 168) return false // privada
  if (a === 192 && b === 0 && (c === 0 || c === 2)) return false // IETF, TEST-NET-1
  if (a === 192 && b === 88 && c === 99) return false // 6to4 relay
  if (a === 198 && (b === 18 || b === 19)) return false // benchmark
  if (a === 198 && b === 51 && c === 100) return false // TEST-NET-2
  if (a === 203 && b === 0 && c === 113) return false // TEST-NET-3
  if (a >= 224) return false // multicast, reservado, broadcast

  return true
}

/** Expande um IPv6 (com `::` e IPv4 no fim) em 8 grupos de 16 bits. */
function parseIpv6(address: string): number[] | null {
  let text = address.toLowerCase()
  const zone = text.indexOf("%")

  if (zone >= 0) {
    text = text.slice(0, zone)
  }

  if (!text.includes(":")) {
    return null
  }

  const lastColon = text.lastIndexOf(":")
  const last = text.slice(lastColon + 1)

  if (last.includes(".")) {
    const octets = parseIpv4(last)

    if (!octets) {
      return null
    }

    const [a = 0, b = 0, c = 0, d = 0] = octets
    text = `${text.slice(0, lastColon + 1)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`
  }

  if (!/^[0-9a-f:]+$/.test(text)) {
    return null
  }

  const halves = text.split("::")

  if (halves.length > 2) {
    return null
  }

  const toGroups = (part: string) =>
    part === ""
      ? []
      : part
          .split(":")
          .map((group) => (/^[0-9a-f]{1,4}$/.test(group) ? parseInt(group, 16) : Number.NaN))

  const head = toGroups(halves[0] ?? "")
  const tail = halves.length === 2 ? toGroups(halves[1] ?? "") : []
  const missing = 8 - head.length - tail.length

  if (halves.length === 2 ? missing < 1 : missing !== 0) {
    return null
  }

  const groups =
    halves.length === 2 ? [...head, ...new Array<number>(missing).fill(0), ...tail] : head

  return groups.every((group) => Number.isInteger(group)) ? groups : null
}

function isPublicIpv6(groups: readonly number[]): boolean {
  const [g0 = 0, g1 = 0, g2 = 0, g3 = 0, g4 = 0, g5 = 0, g6 = 0, g7 = 0] = groups

  if (groups.every((group) => group === 0)) return false // ::
  if (
    g0 === 0 &&
    g1 === 0 &&
    g2 === 0 &&
    g3 === 0 &&
    g4 === 0 &&
    g5 === 0 &&
    g6 === 0 &&
    g7 === 1
  ) {
    return false // ::1
  }

  // IPv4 mapeado (::ffff:a.b.c.d) ou compatível (::a.b.c.d): decide pelo IPv4.
  if (g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0 && (g5 === 0xffff || g5 === 0)) {
    return isPublicIpv4([g6 >> 8, g6 & 0xff, g7 >> 8, g7 & 0xff])
  }

  // NAT64 (64:ff9b::/96) aponta para IPv4 embutido.
  if (g0 === 0x64 && g1 === 0xff9b && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0) {
    return isPublicIpv4([g6 >> 8, g6 & 0xff, g7 >> 8, g7 & 0xff])
  }

  if ((g0 & 0xfe00) === 0xfc00) return false // único local (fc00::/7)
  if ((g0 & 0xffc0) === 0xfe80) return false // link-local
  if ((g0 & 0xffc0) === 0xfec0) return false // site-local (obsoleto)
  if ((g0 & 0xff00) === 0xff00) return false // multicast
  if (g0 === 0x2001 && g1 === 0x0db8) return false // documentação
  if (g0 === 0x2002) return false // 6to4 (pode embutir IPv4 privado)
  if (g0 === 0x2001 && g1 === 0) return false // Teredo
  if (g0 === 0x0100 && g1 === 0 && g2 === 0 && g3 === 0) return false // descarte

  return true
}

/** Formato do endereço IP ou `null` se não for IP. */
export function ipVersion(address: string): 4 | 6 | null {
  const text = address.replace(/^\[|\]$/g, "")

  if (parseIpv4(text)) {
    return 4
  }

  return parseIpv6(text) ? 6 : null
}

/**
 * Endereço que o servidor pode acessar: só IP público. Loopback, redes
 * privadas, link-local (metadados de nuvem), CGNAT, multicast, reservados e
 * IPv6 que embute IPv4 privado são recusados. Texto que não é IP também.
 */
export function isPublicIpAddress(address: string): boolean {
  const text = address.replace(/^\[|\]$/g, "")
  const v4 = parseIpv4(text)

  if (v4) {
    return isPublicIpv4(v4)
  }

  const v6 = parseIpv6(text)

  return v6 ? isPublicIpv6(v6) : false
}

export type PhotoUrlCheck =
  { ok: true; url: URL } | { ok: false; code: "invalid_link" | "blocked_address" }

const BLOCKED_HOST_SUFFIXES = [".localhost", ".local", ".internal", ".home.arpa", ".lan"]

/**
 * Confere um link antes de conectar (e cada redirecionamento): http(s), porta
 * padrão, sem usuário/senha, sem nome de máquina interna e, se o host for IP
 * literal, IP público. A resolução de DNS é conferida de novo na conexão.
 */
export function checkPhotoUrl(raw: string): PhotoUrlCheck {
  const normalized = normalizePhotoUrl(raw)

  if (!normalized) {
    return { ok: false, code: "invalid_link" }
  }

  const url = new URL(normalized)

  if (url.port && url.port !== "80" && url.port !== "443") {
    return { ok: false, code: "blocked_address" }
  }

  const host = url.hostname
    .replace(/^\[|\]$/g, "")
    .toLowerCase()
    .replace(/\.$/, "")

  if (ipVersion(host)) {
    return isPublicIpAddress(host) ? { ok: true, url } : { ok: false, code: "blocked_address" }
  }

  if (
    host === "localhost" ||
    !host.includes(".") ||
    BLOCKED_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix))
  ) {
    return { ok: false, code: "blocked_address" }
  }

  return { ok: true, url }
}

export type SniffedImage = "image/jpeg" | "image/png" | "image/webp" | "image/gif" | "image/avif"

/** Tipo real pelos primeiros bytes (não confia no Content-Type do servidor). */
export function sniffImageType(bytes: Uint8Array): SniffedImage | null {
  const at = (index: number) => bytes[index] ?? -1

  if (at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff) {
    return "image/jpeg"
  }

  if (at(0) === 0x89 && at(1) === 0x50 && at(2) === 0x4e && at(3) === 0x47) {
    return "image/png"
  }

  const ascii = (start: number, end: number) =>
    String.fromCharCode(...Array.from(bytes.subarray(start, end)))

  if (bytes.length >= 12 && ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") {
    return "image/webp"
  }

  if (bytes.length >= 6 && (ascii(0, 6) === "GIF87a" || ascii(0, 6) === "GIF89a")) {
    return "image/gif"
  }

  if (bytes.length >= 12 && ascii(4, 8) === "ftyp" && /^avi[fs]$/.test(ascii(8, 12))) {
    return "image/avif"
  }

  return null
}

// Identificação do tipo de arquivo enviado (MIME, extensão e bytes iniciais).
// Módulo puro: quem lê o arquivo é o navegador.

export type SourceFileKind = "jpeg" | "png" | "webp" | "heic" | "gif" | "svg" | "pdf" | "unknown"

/** Tipos de imagem que o app tenta decodificar e reencodar no navegador. */
export const DECODABLE_IMAGE_KINDS = ["jpeg", "png", "webp", "heic", "gif"] as const

export type DecodableImageKind = (typeof DECODABLE_IMAGE_KINDS)[number]

/** `accept` dos campos de foto: inclui HEIC/HEIF do iPhone (convertido para JPEG). */
export const SOURCE_IMAGE_ACCEPT =
  "image/jpeg,image/png,image/webp,image/heic,image/heif,.jpg,.jpeg,.png,.webp,.heic,.heif"

const MIME_KINDS: Record<string, SourceFileKind> = {
  "image/jpeg": "jpeg",
  "image/jpg": "jpeg",
  "image/pjpeg": "jpeg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
  "image/heif": "heic",
  "image/heic-sequence": "heic",
  "image/heif-sequence": "heic",
  "image/gif": "gif",
  "image/svg+xml": "svg",
  "application/pdf": "pdf",
}

const EXTENSION_KINDS: Record<string, SourceFileKind> = {
  jpg: "jpeg",
  jpeg: "jpeg",
  jfif: "jpeg",
  png: "png",
  webp: "webp",
  heic: "heic",
  heif: "heic",
  hif: "heic",
  gif: "gif",
  svg: "svg",
  svgz: "svg",
  pdf: "pdf",
}

const HEIF_BRANDS = new Set(["heic", "heix", "hevc", "hevx", "heim", "heis", "mif1", "msf1"])

export function isDecodableImageKind(kind: SourceFileKind): kind is DecodableImageKind {
  return (DECODABLE_IMAGE_KINDS as readonly string[]).includes(kind)
}

/**
 * Tipo pelo MIME informado pelo sistema; sem MIME conhecido (Windows costuma
 * mandar vazio para .heic), usa a extensão.
 */
export function detectFileKind(file: {
  type?: string | null
  name?: string | null
}): SourceFileKind {
  const mime = (file.type ?? "").toLowerCase().split(";")[0]?.trim() ?? ""
  const byMime = MIME_KINDS[mime]
  if (byMime) return byMime

  const name = file.name ?? ""
  const lastDot = name.lastIndexOf(".")
  const extension = lastDot >= 0 ? name.slice(lastDot + 1).toLowerCase() : ""
  return EXTENSION_KINDS[extension] ?? "unknown"
}

function ascii(bytes: Uint8Array, start: number, length: number) {
  return String.fromCharCode(...bytes.subarray(start, start + length))
}

/**
 * Tipo pelos bytes iniciais (assinatura). Pega arquivos com extensão errada,
 * como HEIC renomeado para .jpg. `unknown` quando não reconhece.
 */
export function sniffFileKind(bytes: Uint8Array): SourceFileKind {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "jpeg"
  }
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    ascii(bytes, 1, 3) === "PNG" &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a
  ) {
    return "png"
  }
  if (bytes.length >= 6 && (ascii(bytes, 0, 6) === "GIF87a" || ascii(bytes, 0, 6) === "GIF89a")) {
    return "gif"
  }
  if (bytes.length >= 12 && ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WEBP") {
    return "webp"
  }
  if (bytes.length >= 12 && ascii(bytes, 4, 4) === "ftyp" && HEIF_BRANDS.has(ascii(bytes, 8, 4))) {
    return "heic"
  }
  if (bytes.length >= 5 && ascii(bytes, 0, 5) === "%PDF-") {
    return "pdf"
  }

  const head = ascii(bytes, 0, Math.min(bytes.length, 256))
    .replace(/^\xEF\xBB\xBF/, "") // BOM UTF-8 lido byte a byte
    .trimStart()
    .toLowerCase()
  if (head.startsWith("<svg") || (head.startsWith("<?xml") && head.includes("<svg"))) {
    return "svg"
  }

  return "unknown"
}

function skipSubBlocks(bytes: Uint8Array, offset: number) {
  let position = offset
  while (position < bytes.length) {
    const size = bytes[position] ?? 0
    position += 1
    if (size === 0) break
    position += size
  }
  return position
}

/**
 * `true` quando o GIF tem mais de um quadro. Percorre os blocos do arquivo
 * (cabeçalho, paleta, extensões e descritores de imagem) sem decodificar pixels.
 */
export function isAnimatedGif(bytes: Uint8Array): boolean {
  if (sniffFileKind(bytes) !== "gif" || bytes.length < 13) return false

  const packed = bytes[10] ?? 0
  let offset = 13
  if (packed & 0x80) offset += 3 * (1 << ((packed & 0x07) + 1))

  let frames = 0

  while (offset < bytes.length) {
    const block = bytes[offset]

    if (block === 0x2c) {
      frames += 1
      if (frames > 1) return true
      if (offset + 10 > bytes.length) return false
      const imagePacked = bytes[offset + 9] ?? 0
      offset += 10
      if (imagePacked & 0x80) offset += 3 * (1 << ((imagePacked & 0x07) + 1))
      offset += 1 // tamanho mínimo do código LZW
      offset = skipSubBlocks(bytes, offset)
    } else if (block === 0x21) {
      offset = skipSubBlocks(bytes, offset + 2)
    } else {
      // 0x3b (fim do arquivo) ou bloco inválido.
      break
    }
  }

  return false
}

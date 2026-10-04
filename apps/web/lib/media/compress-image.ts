/**
 * Compressão de imagens NO NAVEGADOR, antes do upload ao Storage. Só roda no
 * cliente (usa createImageBitmap, OffscreenCanvas e <canvas>); sem dependências.
 *
 * Proteção de dados (LGPD): a imagem é decodificada e reencodada pelo canvas,
 * então o arquivo enviado NÃO carrega EXIF, coordenadas GPS, data, modelo do
 * aparelho nem a miniatura embutida do original. Isso evita, por exemplo, que a
 * localização de quem fotografou (ou da casa do proprietário) vaze pela foto
 * pública do anúncio ou pela foto de um documento (art. 6º, III, necessidade;
 * art. 46, segurança). A orientação EXIF é aplicada nos pixels antes de ser
 * descartada, então a foto não fica deitada.
 *
 * Regras de tamanho e qualidade: @workspace/core/media/image-sizing (testadas).
 */
import { formatBytes } from "@workspace/core/media/format"
import {
  IMAGE_PRESETS,
  asImageOutputType,
  computeDownscaleSteps,
  computeTargetSize,
  extensionForImageType,
  planCompressionAttempts,
  type ImageOutputType,
  type ImagePreset,
  type ImagePresetName,
  type ImageSize,
} from "@workspace/core/media/image-sizing"
import {
  detectFileKind,
  isAnimatedGif,
  isDecodableImageKind,
  sniffFileKind,
  type DecodableImageKind,
} from "@workspace/core/media/image-type"
import { MAX_SOURCE_IMAGE_BYTES } from "@workspace/core/media/limits"

export type ImageProfile = Exclude<ImagePresetName, "propertyThumb">

export type EncodedImage = ImageSize & {
  blob: Blob
  type: ImageOutputType
  extension: "jpg" | "webp" | "png"
  bytes: number
  quality: number
}

export type PreparedImage = {
  main: EncodedImage
  /** Miniatura WebP de 400 px (JPEG se o navegador não codificar WebP). */
  thumb: EncodedImage | null
  sourceBytes: number
  sourceKind: DecodableImageKind
}

export type ImagePreparationErrorCode =
  "empty" | "too-large" | "unsupported" | "animated" | "decode" | "encode"

export class ImagePreparationError extends Error {
  readonly code: ImagePreparationErrorCode

  constructor(message: string, code: ImagePreparationErrorCode) {
    super(message)
    this.name = "ImagePreparationError"
    this.code = code
  }
}

const FORMAT_HINT = "Envie JPG, PNG, WebP ou HEIC."
const ENCODE_MESSAGE =
  "Não foi possível otimizar a imagem neste navegador. Salve-a em JPEG e tente de novo."

/** Mensagem amigável para qualquer falha de preparo (ou `fallback`). */
export function getImagePreparationMessage(error: unknown, fallback = ENCODE_MESSAGE) {
  return error instanceof ImagePreparationError ? error.message : fallback
}

function decodeMessage(kind: DecodableImageKind) {
  if (kind === "heic") {
    return "Este navegador não abre fotos HEIC. No iPhone, use Ajustes > Câmera > Formatos > Mais Compatível ou exporte a foto em JPEG e envie de novo."
  }
  return "Não foi possível ler esta imagem. Salve-a em JPEG e tente de novo."
}

async function readBytes(file: Blob, length?: number) {
  const slice = length === undefined ? file : file.slice(0, length)
  return new Uint8Array(await slice.arrayBuffer())
}

/**
 * Confere tamanho e formato antes de decodificar. Recusa SVG, PDF, GIF animado
 * e formatos desconhecidos; o tipo vem da assinatura do arquivo (pega HEIC
 * renomeado para .jpg) e, sem assinatura conhecida, do MIME/extensão.
 */
export async function assertSupportedImage(file: File): Promise<DecodableImageKind> {
  if (file.size === 0) {
    throw new ImagePreparationError("O arquivo está vazio.", "empty")
  }
  if (file.size > MAX_SOURCE_IMAGE_BYTES) {
    throw new ImagePreparationError(
      `O arquivo tem ${formatBytes(file.size)}; o limite para otimizar é ${formatBytes(MAX_SOURCE_IMAGE_BYTES)}.`,
      "too-large"
    )
  }

  const sniffed = sniffFileKind(await readBytes(file, 512))
  const kind = sniffed === "unknown" ? detectFileKind(file) : sniffed

  if (kind === "svg") {
    throw new ImagePreparationError(`SVG não é aceito. ${FORMAT_HINT}`, "unsupported")
  }
  if (!isDecodableImageKind(kind)) {
    throw new ImagePreparationError(
      kind === "pdf"
        ? `Este campo aceita só imagens. ${FORMAT_HINT}`
        : `Formato não aceito. ${FORMAT_HINT}`,
      "unsupported"
    )
  }
  if (kind === "gif" && isAnimatedGif(await readBytes(file))) {
    throw new ImagePreparationError(`GIF animado não é aceito. ${FORMAT_HINT}`, "animated")
  }

  return kind
}

// ---------------------------------------------------------------------------
// Decodificação
// ---------------------------------------------------------------------------

type DecodedImage = ImageSize & { source: CanvasImageSource; release: () => void }

async function decodeWithImageElement(file: Blob): Promise<DecodedImage> {
  const url = URL.createObjectURL(file)
  const image = new Image()
  image.decoding = "async"
  image.src = url

  try {
    await image.decode()
  } catch (error) {
    URL.revokeObjectURL(url)
    throw error
  }

  // <img> aplica a orientação EXIF (image-orientation: from-image é o padrão).
  return {
    source: image,
    width: image.naturalWidth,
    height: image.naturalHeight,
    release: () => URL.revokeObjectURL(url),
  }
}

async function decodeImage(file: Blob): Promise<DecodedImage> {
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" })
      return {
        source: bitmap,
        width: bitmap.width,
        height: bitmap.height,
        release: () => bitmap.close(),
      }
    } catch {
      // Navegador sem a opção ou sem o formato no createImageBitmap: tenta <img>.
    }
  }
  return decodeWithImageElement(file)
}

// ---------------------------------------------------------------------------
// Canvas
// ---------------------------------------------------------------------------

type DrawingContext = CanvasDrawImage & CanvasFillStrokeStyles & CanvasRect & CanvasImageSmoothing

type Surface = ImageSize & {
  canvas: OffscreenCanvas | HTMLCanvasElement
  context: DrawingContext
}

function createSurface({ width, height }: ImageSize): Surface {
  if (typeof OffscreenCanvas !== "undefined") {
    const canvas = new OffscreenCanvas(width, height)
    const context = canvas.getContext("2d")
    if (context) return { canvas, context, width, height }
  }

  const canvas = document.createElement("canvas")
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext("2d")
  if (!context) throw new ImagePreparationError(ENCODE_MESSAGE, "encode")
  return { canvas, context, width, height }
}

/** Libera a memória do canvas (importante no celular). */
function releaseSurface(surface: Surface | null) {
  if (!surface) return
  surface.canvas.width = 0
  surface.canvas.height = 0
}

/**
 * Desenha `source` em `target`, reduzindo em etapas de até 2× (sem serrilhado).
 * `background` preenche a transparência na última etapa (JPEG não tem alfa).
 */
function renderScaled(
  source: CanvasImageSource,
  sourceSize: ImageSize,
  target: ImageSize,
  background: string | null
): Surface {
  const steps = computeDownscaleSteps(sourceSize, target)
  let current: CanvasImageSource = source
  let previous: Surface | null = null

  for (const [index, step] of steps.entries()) {
    const surface = createSurface(step)
    const { context } = surface
    context.imageSmoothingEnabled = true
    context.imageSmoothingQuality = "high"
    if (background && index === steps.length - 1) {
      context.fillStyle = background
      context.fillRect(0, 0, step.width, step.height)
    }
    context.drawImage(current, 0, 0, step.width, step.height)
    releaseSurface(previous)
    previous = surface
    current = surface.canvas
  }

  if (!previous) throw new ImagePreparationError(ENCODE_MESSAGE, "encode")
  return previous
}

function encodeSurface(surface: Surface, type: ImageOutputType, quality: number): Promise<Blob> {
  const { canvas } = surface
  if ("convertToBlob" in canvas) {
    return canvas.convertToBlob({ type, quality })
  }
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("toBlob sem resultado"))),
      type,
      quality
    )
  })
}

/** Codifica no formato do preset; se o navegador não suportar, usa o formato reserva. */
async function encodeWithPreset(
  surface: Surface,
  preset: ImagePreset,
  quality: number
): Promise<EncodedImage> {
  let blob = await encodeSurface(surface, preset.type, quality)
  let type = asImageOutputType(blob.type)

  if (type !== preset.type && preset.fallbackType !== preset.type) {
    blob = await encodeSurface(surface, preset.fallbackType, quality)
    type = asImageOutputType(blob.type)
  }
  if (!type) throw new ImagePreparationError(ENCODE_MESSAGE, "encode")

  return {
    blob,
    type,
    extension: extensionForImageType(type),
    bytes: blob.size,
    width: surface.width,
    height: surface.height,
    quality,
  }
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

/**
 * Redimensiona e reencoda a imagem conforme o perfil. Tenta a qualidade
 * inicial e, se passar da meta de bytes, baixa a qualidade e depois as
 * dimensões (plano de @workspace/core). Com `thumbnail`, gera também a
 * miniatura WebP de 400 px a partir da imagem já reduzida.
 */
export async function prepareImage(
  file: File,
  profile: ImageProfile,
  options: { thumbnail?: boolean } = {}
): Promise<PreparedImage> {
  const sourceKind = await assertSupportedImage(file)

  let decoded: DecodedImage
  try {
    decoded = await decodeImage(file)
  } catch {
    throw new ImagePreparationError(decodeMessage(sourceKind), "decode")
  }

  const preset: ImagePreset = IMAGE_PRESETS[profile]
  let surface: Surface | null = null

  try {
    if (!(decoded.width > 0 && decoded.height > 0)) {
      throw new ImagePreparationError(decodeMessage(sourceKind), "decode")
    }

    let best: EncodedImage | null = null

    for (const attempt of planCompressionAttempts(decoded, preset)) {
      if (!surface || surface.width !== attempt.width || surface.height !== attempt.height) {
        releaseSurface(surface)
        surface = null
        surface = renderScaled(decoded.source, decoded, attempt, preset.background)
      }

      const encoded = await encodeWithPreset(surface, preset, attempt.quality)
      if (!best || encoded.bytes < best.bytes) best = encoded
      if (encoded.bytes <= preset.targetMaxBytes) {
        best = encoded
        break
      }
    }

    if (!best || !surface) throw new ImagePreparationError(ENCODE_MESSAGE, "encode")

    let thumb: EncodedImage | null = null

    if (options.thumbnail) {
      const thumbPreset: ImagePreset = IMAGE_PRESETS.propertyThumb
      const thumbSize = computeTargetSize(surface.width, surface.height, thumbPreset.maxDimension)
      const thumbSurface = renderScaled(surface.canvas, surface, thumbSize, thumbPreset.background)
      try {
        thumb = await encodeWithPreset(thumbSurface, thumbPreset, thumbPreset.quality)
      } finally {
        releaseSurface(thumbSurface)
      }
    }

    return { main: best, thumb, sourceBytes: file.size, sourceKind }
  } catch (error) {
    if (error instanceof ImagePreparationError) throw error
    throw new ImagePreparationError(ENCODE_MESSAGE, "encode")
  } finally {
    releaseSurface(surface)
    decoded.release()
  }
}

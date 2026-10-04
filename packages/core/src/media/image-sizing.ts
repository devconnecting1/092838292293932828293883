// Regras puras de redimensionamento e compressão de imagens (sem DOM).
// Quem executa o plano com canvas é apps/web/lib/media/compress-image.ts.

export type ImageOutputType = "image/jpeg" | "image/webp" | "image/png"

export type ImageSize = { width: number; height: number }

export type ImagePreset = {
  /** Formato pedido ao encoder do navegador. */
  type: ImageOutputType
  /** Formato usado quando o navegador não codifica `type` (ex.: Safari antigo sem WebP). */
  fallbackType: ImageOutputType
  /** Lado maior máximo, em px. Imagem menor nunca é ampliada. */
  maxDimension: number
  /** Qualidade inicial (0 a 1). PNG ignora. */
  quality: number
  /** Menor qualidade aceita antes de reduzir as dimensões. */
  minQuality: number
  /** Acima disso tenta de novo: primeiro com qualidade menor, depois com dimensões menores. */
  targetMaxBytes: number
  /** Menor lado maior aceito ao reduzir dimensões. */
  minDimension: number
  /** Cor aplicada sob transparência; `null` preserva o canal alfa. */
  background: string | null
}

const KB = 1024
const MB = 1024 * KB

/** Passo de qualidade entre tentativas. */
export const QUALITY_STEP = 0.1

/** Fator aplicado ao lado maior a cada tentativa de redução de dimensões. */
export const DIMENSION_STEP = 0.8

export const IMAGE_PRESETS = {
  /**
   * Foto principal do imóvel. JPEG (e não WebP) porque o feed VRSync é lido
   * pelo Grupo OLX e o suporte a WebP nos portais não está confirmado.
   * Meta de ~150–300 KB; teto de 1,5 MB.
   */
  propertyPhoto: {
    type: "image/jpeg",
    fallbackType: "image/jpeg",
    maxDimension: 1600,
    quality: 0.8,
    minQuality: 0.6,
    targetMaxBytes: 1.5 * MB,
    minDimension: 1024,
    background: "#ffffff",
  },
  /** Miniatura das listas e cards (~20–40 KB), gravada ao lado da principal. */
  propertyThumb: {
    type: "image/webp",
    fallbackType: "image/jpeg",
    maxDimension: 400,
    quality: 0.75,
    minQuality: 0.75,
    targetMaxBytes: 150 * KB,
    minDimension: 400,
    background: "#ffffff",
  },
  /** Banners, fundo e imagem de compartilhamento das landing pages. */
  landingBanner: {
    type: "image/jpeg",
    fallbackType: "image/jpeg",
    maxDimension: 1920,
    quality: 0.8,
    minQuality: 0.6,
    targetMaxBytes: 1.5 * MB,
    minDimension: 1280,
    background: "#ffffff",
  },
  /** Logo: preserva transparência (WebP; PNG se o navegador não codificar WebP). */
  landingLogo: {
    type: "image/webp",
    fallbackType: "image/png",
    maxDimension: 512,
    quality: 0.9,
    minQuality: 0.9,
    targetMaxBytes: 1 * MB,
    minDimension: 512,
    background: null,
  },
  /** Foto de documento (RG, comprovante): resolução alta para manter a legibilidade. */
  clientDocumentImage: {
    type: "image/jpeg",
    fallbackType: "image/jpeg",
    maxDimension: 2000,
    quality: 0.85,
    minQuality: 0.7,
    targetMaxBytes: 3 * MB,
    minDimension: 1600,
    background: "#ffffff",
  },
} as const satisfies Record<string, ImagePreset>

export type ImagePresetName = keyof typeof IMAGE_PRESETS

export type CompressionAttempt = ImageSize & { quality: number }

function roundQuality(value: number) {
  return Math.round(value * 100) / 100
}

function assertPositiveSize(width: number, height: number) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new RangeError("Dimensões da imagem inválidas.")
  }
}

/**
 * Tamanho final com o lado maior limitado a `maxDimension`, mantendo a
 * proporção. Não amplia imagens menores.
 */
export function computeTargetSize(width: number, height: number, maxDimension: number): ImageSize {
  assertPositiveSize(width, height)
  if (!Number.isFinite(maxDimension) || maxDimension <= 0) {
    throw new RangeError("Dimensão máxima inválida.")
  }

  const longest = Math.max(width, height)
  if (longest <= maxDimension) {
    return { width: Math.round(width), height: Math.round(height) }
  }

  const scale = maxDimension / longest
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  }
}

/** Qualidades tentadas, da inicial até a mínima, sempre incluindo a mínima. */
export function qualitySteps(preset: Pick<ImagePreset, "quality" | "minQuality">): number[] {
  const steps: number[] = []
  for (
    let quality = roundQuality(preset.quality);
    quality > preset.minQuality + 1e-9;
    quality = roundQuality(quality - QUALITY_STEP)
  ) {
    steps.push(quality)
  }
  steps.push(roundQuality(preset.minQuality))
  return steps
}

/**
 * Sequência de tentativas de codificação: no tamanho-alvo, baixa a qualidade
 * até `minQuality`; depois reduz o lado maior em 20% por vez até
 * `minDimension`, já na qualidade mínima. O navegador para na primeira
 * tentativa que couber em `targetMaxBytes` (ou fica com a menor).
 */
export function planCompressionAttempts(
  source: ImageSize,
  preset: Pick<ImagePreset, "maxDimension" | "quality" | "minQuality" | "minDimension">
): CompressionAttempt[] {
  const base = computeTargetSize(source.width, source.height, preset.maxDimension)
  const attempts: CompressionAttempt[] = qualitySteps(preset).map((quality) => ({
    ...base,
    quality,
  }))

  const minQuality = roundQuality(preset.minQuality)
  let longest = Math.max(base.width, base.height)

  while (longest > preset.minDimension) {
    longest = Math.max(preset.minDimension, Math.round(longest * DIMENSION_STEP))
    attempts.push({
      ...computeTargetSize(source.width, source.height, longest),
      quality: minQuality,
    })
  }

  return attempts
}

/**
 * Tamanhos intermediários para reduzir em etapas de no máximo 2× (evita o
 * serrilhado de um único drawImage de 4000 px para 400 px). O último item é
 * sempre o tamanho-alvo.
 */
export function computeDownscaleSteps(source: ImageSize, target: ImageSize): ImageSize[] {
  assertPositiveSize(source.width, source.height)
  assertPositiveSize(target.width, target.height)

  const steps: ImageSize[] = []
  let width = source.width
  let height = source.height

  while (width / 2 > target.width && height / 2 > target.height) {
    width = Math.round(width / 2)
    height = Math.round(height / 2)
    steps.push({ width, height })
  }

  steps.push({ width: target.width, height: target.height })
  return steps
}

/** Extensão do arquivo gravado no Storage para cada formato de saída. */
export function extensionForImageType(type: ImageOutputType): "jpg" | "webp" | "png" {
  if (type === "image/webp") return "webp"
  if (type === "image/png") return "png"
  return "jpg"
}

/** Normaliza o `blob.type` devolvido pelo encoder; `null` se não for um formato de saída. */
export function asImageOutputType(type: string): ImageOutputType | null {
  const normalized = type.toLowerCase()
  return normalized === "image/jpeg" || normalized === "image/webp" || normalized === "image/png"
    ? normalized
    : null
}

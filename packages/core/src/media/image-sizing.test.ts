import { describe, expect, it } from "vitest"

import {
  IMAGE_PRESETS,
  asImageOutputType,
  computeDownscaleSteps,
  computeTargetSize,
  extensionForImageType,
  planCompressionAttempts,
  qualitySteps,
} from "./image-sizing"

describe("computeTargetSize", () => {
  it("limita o lado maior mantendo a proporção", () => {
    expect(computeTargetSize(4000, 3000, 1600)).toEqual({ width: 1600, height: 1200 })
    expect(computeTargetSize(1080, 1920, 1600)).toEqual({ width: 900, height: 1600 })
    expect(computeTargetSize(5000, 2813, 1920)).toEqual({ width: 1920, height: 1080 })
  })

  it("não amplia imagem menor que o limite", () => {
    expect(computeTargetSize(800, 600, 1600)).toEqual({ width: 800, height: 600 })
    expect(computeTargetSize(1600, 900, 1600)).toEqual({ width: 1600, height: 900 })
  })

  it("nunca devolve lado zero em imagens muito estreitas", () => {
    expect(computeTargetSize(10000, 2, 400)).toEqual({ width: 400, height: 1 })
  })

  it("recusa dimensões inválidas", () => {
    expect(() => computeTargetSize(0, 100, 400)).toThrow(RangeError)
    expect(() => computeTargetSize(100, Number.NaN, 400)).toThrow(RangeError)
    expect(() => computeTargetSize(100, 100, 0)).toThrow(RangeError)
  })
})

describe("qualitySteps", () => {
  it("desce de 0,1 em 0,1 até a mínima, sem erro de ponto flutuante", () => {
    expect(qualitySteps(IMAGE_PRESETS.propertyPhoto)).toEqual([0.8, 0.7, 0.6])
    expect(qualitySteps(IMAGE_PRESETS.clientDocumentImage)).toEqual([0.85, 0.75, 0.7])
    expect(qualitySteps(IMAGE_PRESETS.propertyThumb)).toEqual([0.75])
  })
})

describe("planCompressionAttempts", () => {
  it("foto de celular: qualidade até 0,6 e depois dimensões até 1024 px", () => {
    expect(
      planCompressionAttempts({ width: 4000, height: 3000 }, IMAGE_PRESETS.propertyPhoto)
    ).toEqual([
      { width: 1600, height: 1200, quality: 0.8 },
      { width: 1600, height: 1200, quality: 0.7 },
      { width: 1600, height: 1200, quality: 0.6 },
      { width: 1280, height: 960, quality: 0.6 },
      { width: 1024, height: 768, quality: 0.6 },
    ])
  })

  it("imagem pequena não é ampliada nem reduzida abaixo do tamanho original", () => {
    expect(
      planCompressionAttempts({ width: 800, height: 600 }, IMAGE_PRESETS.propertyPhoto)
    ).toEqual([
      { width: 800, height: 600, quality: 0.8 },
      { width: 800, height: 600, quality: 0.7 },
      { width: 800, height: 600, quality: 0.6 },
    ])
  })

  it("miniatura: uma tentativa em 400 px", () => {
    expect(
      planCompressionAttempts({ width: 1600, height: 1200 }, IMAGE_PRESETS.propertyThumb)
    ).toEqual([{ width: 400, height: 300, quality: 0.75 }])
  })

  it("documento em pé: preserva legibilidade (mínimo 1600 px)", () => {
    expect(
      planCompressionAttempts({ width: 3000, height: 4000 }, IMAGE_PRESETS.clientDocumentImage)
    ).toEqual([
      { width: 1500, height: 2000, quality: 0.85 },
      { width: 1500, height: 2000, quality: 0.75 },
      { width: 1500, height: 2000, quality: 0.7 },
      { width: 1200, height: 1600, quality: 0.7 },
    ])
  })

  it("banner: 1920 px e reduções até 1280 px", () => {
    expect(
      planCompressionAttempts({ width: 5000, height: 2813 }, IMAGE_PRESETS.landingBanner).map(
        ({ width, height }) => `${width}x${height}`
      )
    ).toEqual(["1920x1080", "1920x1080", "1920x1080", "1536x864", "1280x720"])
  })

  it("logo: 512 px sem tentativas extras", () => {
    expect(
      planCompressionAttempts({ width: 2048, height: 1024 }, IMAGE_PRESETS.landingLogo)
    ).toEqual([{ width: 512, height: 256, quality: 0.9 }])
  })
})

describe("computeDownscaleSteps", () => {
  it("reduz em etapas de no máximo 2×", () => {
    expect(
      computeDownscaleSteps({ width: 4000, height: 3000 }, { width: 400, height: 300 })
    ).toEqual([
      { width: 2000, height: 1500 },
      { width: 1000, height: 750 },
      { width: 500, height: 375 },
      { width: 400, height: 300 },
    ])
  })

  it("vai direto quando a redução é pequena ou não há redução", () => {
    expect(
      computeDownscaleSteps({ width: 3000, height: 2000 }, { width: 1600, height: 1067 })
    ).toEqual([{ width: 1600, height: 1067 }])
    expect(computeDownscaleSteps({ width: 800, height: 600 }, { width: 800, height: 600 })).toEqual(
      [{ width: 800, height: 600 }]
    )
  })
})

describe("formatos de saída", () => {
  it("extensão por tipo", () => {
    expect(extensionForImageType("image/jpeg")).toBe("jpg")
    expect(extensionForImageType("image/webp")).toBe("webp")
    expect(extensionForImageType("image/png")).toBe("png")
  })

  it("normaliza o tipo devolvido pelo encoder", () => {
    expect(asImageOutputType("image/WEBP")).toBe("image/webp")
    expect(asImageOutputType("image/png")).toBe("image/png")
    expect(asImageOutputType("image/gif")).toBeNull()
    expect(asImageOutputType("")).toBeNull()
  })

  it("foto principal é JPEG (feed VRSync) e miniatura é WebP", () => {
    expect(IMAGE_PRESETS.propertyPhoto.type).toBe("image/jpeg")
    expect(IMAGE_PRESETS.propertyThumb.type).toBe("image/webp")
    expect(IMAGE_PRESETS.landingLogo.background).toBeNull()
  })
})

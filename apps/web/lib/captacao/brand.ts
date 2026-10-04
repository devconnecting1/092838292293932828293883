import type { CSSProperties } from "react"

function channelToLinear(channel: number) {
  const value = channel / 255
  return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
}

function relativeLuminance(hex: string) {
  const raw = hex.slice(1)
  const full =
    raw.length === 3
      ? raw
          .split("")
          .map((char) => char + char)
          .join("")
      : raw
  const [r, g, b] = [0, 2, 4].map((index) =>
    channelToLinear(Number.parseInt(full.slice(index, index + 2), 16))
  )

  return 0.2126 * (r ?? 0) + 0.7152 * (g ?? 0) + 0.0722 * (b ?? 0)
}

/**
 * Aplica a cor da marca da imobiliária (hex já validado) nos tokens do tema,
 * escolhendo o texto (branco ou quase preto) com mais contraste.
 */
export function brandCssVariables(color: string | null): CSSProperties | undefined {
  if (!color) {
    return undefined
  }

  const luminance = relativeLuminance(color)
  const contrastWithWhite = 1.05 / (luminance + 0.05)
  const contrastWithBlack = (luminance + 0.05) / 0.05

  return {
    "--primary": color,
    "--primary-foreground": contrastWithWhite >= contrastWithBlack ? "#ffffff" : "#0a0a0a",
    "--ring": color,
  } as CSSProperties
}

/**
 * Sistema de tema das landing pages.
 *
 * `resolveLandingTheme(theme, organizationBrand)` transforma o jsonb do tema +
 * a marca da imobiliária em tokens prontos:
 *   - cores validadas (`#RRGGBB`) com fallback para a marca e derivações;
 *   - variações (hover, suave, borda) e, para CADA fundo, a cor de texto
 *     legível calculada por contraste WCAG 2.x (≥ 4.5:1);
 *   - URLs públicas das imagens do Storage;
 *   - `style`: CSS custom properties (`--lp-*`) para aplicar num wrapper e
 *     consumir com classes Tailwind arbitrárias (`bg-(--lp-primary)`).
 *     Também remapeia os tokens do shadcn (`--primary`, `--ring`…) dentro do
 *     wrapper, para o formulário de lead injetado herdar a marca.
 *
 * Tudo aqui é puro e isomórfico (servidor, editor no cliente e testes).
 *
 * Regras de contraste (ver `pickTextOn` e `fillWithText`):
 *   1. Texto sobre um fundo sólido: branco se ≥ 4.5:1; senão tinta escura se
 *      ≥ 4.5:1; senão preto/branco puro, o maior (sempre ≥ 4.58:1).
 *   2. Preenchimentos com texto (botões, faixas): se a cor é clara
 *      (luminância ≥ 0.4) usa texto escuro; se é média e o branco não passa,
 *      ESCURECE a cor aos poucos (até 30% rumo ao preto) para manter texto
 *      branco — a marca continua reconhecível; se nem assim, texto escuro.
 *   3. Hover escurece/clareia no sentido que AUMENTA o contraste com o texto
 *      já escolhido, então nunca fica abaixo de 4.5:1.
 *   4. Cor usada como texto (links, preços, ícones) sobre o fundo claro da
 *      página é escurecida até ≥ 4.5:1 contra o fundo mais escuro onde aparece.
 *   5. Texto sobre foto: véu (`--lp-scrim`) calculado para que o texto branco
 *      tenha ≥ 4.5:1 mesmo sobre o pixel mais claro possível (branco) com o
 *      véu a 72% de opacidade.
 *   6. Borda de campo e anel de foco: ≥ 3:1 contra o fundo (WCAG 1.4.11).
 */
import type { CSSProperties } from "react"

import {
  LANDING_ASSETS_BUCKET,
  LANDING_HEX_COLOR_PATTERN,
  isHttpsUrl,
  isSafeStoragePath,
  type LandingOrganizationBrand,
  type LandingTheme,
} from "@/lib/landing/types"

// ---------------------------------------------------------------------------
// Constantes
// ---------------------------------------------------------------------------

export type HexColor = `#${string}`

export const WCAG_AA_TEXT = 4.5
export const WCAG_AA_NON_TEXT = 3

const WHITE: HexColor = "#FFFFFF"
const BLACK: HexColor = "#000000"
/** Tinta escura padrão para texto sobre fundos claros. */
const DARK_INK: HexColor = "#16181D"
/** Cor da marca quando nem o tema nem a imobiliária definem uma. */
export const LANDING_FALLBACK_PRIMARY: HexColor = "#1F5F8B"

/** Opacidade do véu sobre fotos (usada no cálculo da regra 5 e no CSS). */
export const LANDING_SCRIM_OPACITY = 0.72

// ---------------------------------------------------------------------------
// Aritmética de cor (pura)
// ---------------------------------------------------------------------------

type Rgb = { r: number; g: number; b: number }

export function isHexColor(value: unknown): value is HexColor {
  return typeof value === "string" && LANDING_HEX_COLOR_PATTERN.test(value)
}

export function hexToRgb(hex: HexColor): Rgb {
  return {
    r: Number.parseInt(hex.slice(1, 3), 16),
    g: Number.parseInt(hex.slice(3, 5), 16),
    b: Number.parseInt(hex.slice(5, 7), 16),
  }
}

function channelToHex(channel: number) {
  return Math.round(Math.min(255, Math.max(0, channel)))
    .toString(16)
    .padStart(2, "0")
}

export function rgbToHex({ r, g, b }: Rgb): HexColor {
  return `#${channelToHex(r)}${channelToHex(g)}${channelToHex(b)}`.toUpperCase() as HexColor
}

/** Mistura linear em sRGB: `amount` 0 → `from`, 1 → `to`. */
export function mixColors(from: HexColor, to: HexColor, amount: number): HexColor {
  const t = Math.min(1, Math.max(0, amount))
  const a = hexToRgb(from)
  const b = hexToRgb(to)
  return rgbToHex({
    r: a.r + (b.r - a.r) * t,
    g: a.g + (b.g - a.g) * t,
    b: a.b + (b.b - a.b) * t,
  })
}

function linearize(channel: number) {
  const value = channel / 255
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
}

/** Luminância relativa WCAG 2.x (0 = preto, 1 = branco). */
export function relativeLuminance(hex: HexColor) {
  const { r, g, b } = hexToRgb(hex)
  return 0.2126 * linearize(r) + 0.7152 * linearize(g) + 0.0722 * linearize(b)
}

/** Razão de contraste WCAG entre duas cores (1 a 21). */
export function contrastRatio(a: HexColor, b: HexColor) {
  const la = relativeLuminance(a)
  const lb = relativeLuminance(b)
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

type Hsl = { h: number; s: number; l: number }

function rgbToHsl({ r, g, b }: Rgb): Hsl {
  const rn = r / 255
  const gn = g / 255
  const bn = b / 255
  const max = Math.max(rn, gn, bn)
  const min = Math.min(rn, gn, bn)
  const l = (max + min) / 2
  if (max === min) return { h: 0, s: 0, l }
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h: number
  if (max === rn) h = (gn - bn) / d + (gn < bn ? 6 : 0)
  else if (max === gn) h = (bn - rn) / d + 2
  else h = (rn - gn) / d + 4
  return { h: h * 60, s, l }
}

function hslToRgb({ h, s, l }: Hsl): Rgb {
  const hue = (((h % 360) + 360) % 360) / 360
  if (s === 0) return { r: l * 255, g: l * 255, b: l * 255 }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s
  const p = 2 * l - q
  const toChannel = (t: number) => {
    let tt = t
    if (tt < 0) tt += 1
    if (tt > 1) tt -= 1
    if (tt < 1 / 6) return p + (q - p) * 6 * tt
    if (tt < 1 / 2) return q
    if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6
    return p
  }
  return {
    r: toChannel(hue + 1 / 3) * 255,
    g: toChannel(hue) * 255,
    b: toChannel(hue - 1 / 3) * 255,
  }
}

// ---------------------------------------------------------------------------
// Regras de contraste
// ---------------------------------------------------------------------------

/**
 * Regra 1 — cor de texto legível sobre um fundo sólido.
 * Casos documentados (theme.test.ts):
 *   pickTextOn("#FFFFFF") → "#16181D"   pickTextOn("#000000") → "#FFFFFF"
 *   pickTextOn("#0C6B63") → "#FFFFFF"   pickTextOn("#FACC15") → "#16181D"
 *   pickTextOn("#777777") → "#000000"   (branco 4.48 e tinta escura 3.97 não
 *                                        passam; preto puro dá 4.69)
 */
export function pickTextOn(background: HexColor, minimum = WCAG_AA_TEXT): HexColor {
  if (contrastRatio(WHITE, background) >= minimum) return WHITE
  if (contrastRatio(DARK_INK, background) >= minimum) return DARK_INK
  return contrastRatio(WHITE, background) >= contrastRatio(BLACK, background) ? WHITE : BLACK
}

/**
 * Empurra `color` rumo ao preto ou ao branco (passos de 2%) até atingir
 * `minimum` contra `against`. Direção automática: a que se afasta do fundo.
 * Retorna a cor original se já passa.
 */
export function ensureContrast(
  color: HexColor,
  against: HexColor,
  minimum = WCAG_AA_TEXT
): HexColor {
  if (contrastRatio(color, against) >= minimum) return color
  const target = relativeLuminance(against) > 0.18 ? BLACK : WHITE
  for (let step = 1; step <= 50; step += 1) {
    const candidate = mixColors(color, target, step * 0.02)
    if (contrastRatio(candidate, against) >= minimum) return candidate
  }
  return target
}

export type ColorFill = {
  /** Fundo (pode ser a cor da marca levemente escurecida — regra 2). */
  fill: HexColor
  /** Texto sobre o fundo (≥ 4.5:1). */
  text: HexColor
  /** Fundo no hover/pressionado (contraste com `text` mantido ou maior). */
  hover: HexColor
}

/** Regras 2 e 3 — preenchimento com texto (botões, faixas, selos). */
export function fillWithText(color: HexColor): ColorFill {
  let fill = color
  let text: HexColor

  if (contrastRatio(WHITE, color) >= WCAG_AA_TEXT) {
    text = WHITE
  } else if (relativeLuminance(color) >= 0.4) {
    text = pickTextOn(color)
  } else {
    let darkened: HexColor | null = null
    for (let step = 1; step <= 15; step += 1) {
      const candidate = mixColors(color, BLACK, step * 0.02)
      if (contrastRatio(WHITE, candidate) >= WCAG_AA_TEXT) {
        darkened = candidate
        break
      }
    }
    if (darkened) {
      fill = darkened
      text = WHITE
    } else {
      text = pickTextOn(color)
    }
  }

  // Hover: afasta o fundo do texto (texto claro → fundo escurece; texto escuro → clareia).
  const textIsLight = relativeLuminance(text) > 0.5
  const hover = textIsLight ? mixColors(fill, BLACK, 0.14) : mixColors(fill, WHITE, 0.22)

  return { fill, text, hover }
}

/**
 * Regra 5 — véu para texto branco sobre foto: escurece `base` até que o véu
 * a `LANDING_SCRIM_OPACITY` sobre um pixel branco ainda dê ≥ 4.5:1 com branco.
 */
export function scrimFor(base: HexColor): HexColor {
  const passes = (candidate: HexColor) =>
    contrastRatio(WHITE, mixColors(candidate, WHITE, 1 - LANDING_SCRIM_OPACITY)) >= WCAG_AA_TEXT
  if (passes(base)) return base
  for (let step = 1; step <= 50; step += 1) {
    const candidate = mixColors(base, BLACK, step * 0.02)
    if (passes(candidate)) return candidate
  }
  return BLACK
}

// ---------------------------------------------------------------------------
// Derivação de paleta
// ---------------------------------------------------------------------------

/** Secundária derivada: tom profundo da primária (superfícies escuras, rodapé). */
export function deriveSecondary(primary: HexColor): HexColor {
  const luminance = relativeLuminance(primary)
  // Marcas já muito escuras recebem menos mistura para não virar preto chapado.
  return mixColors(primary, "#05070A", luminance < 0.05 ? 0.35 : 0.62)
}

/**
 * Destaque derivado: tom análogo (+32° no círculo cromático) com saturação e
 * luminosidade controladas. Marcas sem saturação (cinza/preto) usam a própria
 * primária clareada — um destaque colorido inventado brigaria com a marca.
 */
export function deriveAccent(primary: HexColor): HexColor {
  const hsl = rgbToHsl(hexToRgb(primary))
  if (hsl.s < 0.12) return mixColors(primary, WHITE, 0.25)
  return rgbToHex(
    hslToRgb({
      h: hsl.h + 32,
      s: Math.min(0.85, Math.max(0.5, hsl.s)),
      l: Math.min(0.52, Math.max(0.4, hsl.l)),
    })
  )
}

// ---------------------------------------------------------------------------
// URLs do Storage
// ---------------------------------------------------------------------------

/**
 * `${base}/storage/v1/object/public/<bucket>/<path>` com `encodeURIComponent`
 * por segmento. `null` quando falta base ou o caminho é inseguro.
 */
export function buildPublicStorageUrl(
  baseUrl: string | null | undefined,
  bucket: string,
  path: string | null | undefined
): string | null {
  if (!baseUrl || !isSafeStoragePath(path)) return null
  let origin: string
  try {
    const url = new URL(baseUrl)
    if (url.protocol !== "https:" && url.protocol !== "http:") return null
    origin = `${url.origin}${url.pathname}`.replace(/\/+$/, "")
  } catch {
    return null
  }
  const encoded = path.split("/").map(encodeURIComponent).join("/")
  return `${origin}/storage/v1/object/public/${encodeURIComponent(bucket)}/${encoded}`
}

/** Base pública do Supabase (referência literal para o Next inlinar no cliente). */
export function getStorageBaseUrl(): string | null {
  const value = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()
  return value ? value : null
}

// ---------------------------------------------------------------------------
// Tema resolvido
// ---------------------------------------------------------------------------

export type ResolvedLandingColors = {
  /** Cor da marca crua (decoração sem texto por cima: fios, gradientes). */
  brand: HexColor
  primary: HexColor
  primaryHover: HexColor
  onPrimary: HexColor
  /** Fundo suave (tinta clara da primária) e o texto legível sobre ele. */
  primarySoft: HexColor
  onPrimarySoft: HexColor
  primaryBorder: HexColor
  /** Primária como TEXTO/ícone sobre as superfícies claras (regra 4). */
  primaryText: HexColor

  secondary: HexColor
  secondaryHover: HexColor
  onSecondary: HexColor
  /** Texto secundário sobre a secundária (≥ 4.5:1). */
  onSecondaryMuted: HexColor
  secondaryBorder: HexColor

  accent: HexColor
  accentHover: HexColor
  onAccent: HexColor
  accentSoft: HexColor
  onAccentSoft: HexColor
  accentText: HexColor

  surface: HexColor
  surfaceAlt: HexColor
  ink: HexColor
  inkMuted: HexColor
  line: HexColor
  /** Borda de campo (≥ 3:1 contra a superfície). */
  inputBorder: HexColor
  focus: HexColor
  scrim: HexColor
  onScrim: HexColor
}

export type ResolvedLandingImages = {
  background: string | null
  banners: string[]
  logo: string | null
}

export type ResolvedLandingTheme = {
  colors: ResolvedLandingColors
  images: ResolvedLandingImages
  /** Origem de cada cor, útil para o editor mostrar "derivada da marca". */
  source: {
    primary: "theme" | "organization" | "fallback"
    secondary: "theme" | "derived"
    accent: "theme" | "derived"
  }
  /** CSS custom properties para o wrapper da landing. */
  style: CSSProperties
}

export type ResolveLandingThemeOptions = {
  /** Base do Supabase; padrão `NEXT_PUBLIC_SUPABASE_URL`. Passe `null` para não gerar URLs. */
  storageBaseUrl?: string | null
}

export function resolveLandingTheme(
  theme: LandingTheme | null | undefined,
  organizationBrand: LandingOrganizationBrand | null | undefined,
  options: ResolveLandingThemeOptions = {}
): ResolvedLandingTheme {
  const themePrimary = isHexColor(theme?.primary_color) ? theme.primary_color : null
  const orgPrimary = isHexColor(organizationBrand?.primary_color)
    ? organizationBrand.primary_color
    : null
  const brand = (themePrimary ?? orgPrimary ?? LANDING_FALLBACK_PRIMARY).toUpperCase() as HexColor

  const secondaryInput = isHexColor(theme?.secondary_color)
    ? (theme.secondary_color.toUpperCase() as HexColor)
    : null
  const accentInput = isHexColor(theme?.accent_color)
    ? (theme.accent_color.toUpperCase() as HexColor)
    : null

  const surface = WHITE
  const surfaceAlt = mixColors(brand, WHITE, 0.94)

  const primaryFill = fillWithText(brand)
  const primarySoft = mixColors(brand, WHITE, 0.88)
  // Contra o fundo mais escuro onde a cor aparece como texto.
  const primaryText = ensureContrast(brand, primarySoft)

  const secondaryBase = secondaryInput ?? deriveSecondary(brand)
  const secondaryFill = fillWithText(secondaryBase)
  const onSecondaryMuted = ensureContrast(
    mixColors(secondaryFill.text, secondaryFill.fill, 0.28),
    secondaryFill.fill
  )

  const accentBase = accentInput ?? deriveAccent(brand)
  const accentFill = fillWithText(accentBase)
  const accentSoft = mixColors(accentBase, WHITE, 0.86)
  const accentText = ensureContrast(accentBase, accentSoft)

  const ink = ensureContrast(mixColors(brand, DARK_INK, 0.9), surfaceAlt, 12)
  const inkMuted = ensureContrast(mixColors(ink, WHITE, 0.38), mixColors(brand, WHITE, 0.88))
  const line = mixColors(brand, "#D9DDE3", 0.82)
  const inputBorder = ensureContrast(mixColors(brand, "#8A919C", 0.75), surface, WCAG_AA_NON_TEXT)
  const focus = ensureContrast(brand, surfaceAlt, WCAG_AA_NON_TEXT)
  const scrim = scrimFor(mixColors(secondaryFill.fill, "#05070A", 0.35))

  const colors: ResolvedLandingColors = {
    brand,
    primary: primaryFill.fill,
    primaryHover: primaryFill.hover,
    onPrimary: primaryFill.text,
    primarySoft,
    onPrimarySoft: primaryText,
    primaryBorder: mixColors(brand, WHITE, 0.7),
    primaryText,

    secondary: secondaryFill.fill,
    secondaryHover: secondaryFill.hover,
    onSecondary: secondaryFill.text,
    onSecondaryMuted,
    secondaryBorder: mixColors(secondaryFill.fill, secondaryFill.text, 0.18),

    accent: accentFill.fill,
    accentHover: accentFill.hover,
    onAccent: accentFill.text,
    accentSoft,
    onAccentSoft: accentText,
    accentText,

    surface,
    surfaceAlt,
    ink,
    inkMuted,
    line,
    inputBorder,
    focus,
    scrim,
    onScrim: WHITE,
  }

  const baseUrl =
    options.storageBaseUrl === undefined ? getStorageBaseUrl() : options.storageBaseUrl
  const assetUrl = (path: string | null | undefined) =>
    buildPublicStorageUrl(baseUrl, LANDING_ASSETS_BUCKET, path)

  const images: ResolvedLandingImages = {
    background: assetUrl(theme?.background_image_path),
    banners: (theme?.banner_image_paths ?? [])
      .map((path) => assetUrl(path))
      .filter((url): url is string => url !== null),
    logo:
      assetUrl(theme?.logo_path) ??
      (isHttpsUrl(organizationBrand?.logo_url) ? organizationBrand.logo_url : null),
  }

  return {
    colors,
    images,
    source: {
      primary: themePrimary ? "theme" : orgPrimary ? "organization" : "fallback",
      secondary: secondaryInput ? "theme" : "derived",
      accent: accentInput ? "theme" : "derived",
    },
    style: landingThemeStyle(colors),
  }
}

/** Tokens → CSS custom properties (somente valores hex validados, nada de CSS livre). */
export function landingThemeStyle(colors: ResolvedLandingColors): CSSProperties {
  const variables: Record<string, string> = {
    "--lp-brand": colors.brand,
    "--lp-primary": colors.primary,
    "--lp-primary-hover": colors.primaryHover,
    "--lp-on-primary": colors.onPrimary,
    "--lp-primary-soft": colors.primarySoft,
    "--lp-on-primary-soft": colors.onPrimarySoft,
    "--lp-primary-border": colors.primaryBorder,
    "--lp-primary-text": colors.primaryText,
    "--lp-secondary": colors.secondary,
    "--lp-secondary-hover": colors.secondaryHover,
    "--lp-on-secondary": colors.onSecondary,
    "--lp-on-secondary-muted": colors.onSecondaryMuted,
    "--lp-secondary-border": colors.secondaryBorder,
    "--lp-accent": colors.accent,
    "--lp-accent-hover": colors.accentHover,
    "--lp-on-accent": colors.onAccent,
    "--lp-accent-soft": colors.accentSoft,
    "--lp-on-accent-soft": colors.onAccentSoft,
    "--lp-accent-text": colors.accentText,
    "--lp-surface": colors.surface,
    "--lp-surface-alt": colors.surfaceAlt,
    "--lp-ink": colors.ink,
    "--lp-ink-muted": colors.inkMuted,
    "--lp-line": colors.line,
    "--lp-input-border": colors.inputBorder,
    "--lp-focus": colors.focus,
    "--lp-scrim": colors.scrim,
    "--lp-on-scrim": colors.onScrim,

    // Tokens do shadcn dentro do wrapper: o formulário injetado (L3) e os
    // componentes de @workspace/ui herdam a marca e ficam sempre claros.
    "--background": colors.surface,
    "--foreground": colors.ink,
    "--card": colors.surface,
    "--card-foreground": colors.ink,
    "--popover": colors.surface,
    "--popover-foreground": colors.ink,
    "--primary": colors.primary,
    "--primary-foreground": colors.onPrimary,
    "--secondary": colors.surfaceAlt,
    "--secondary-foreground": colors.ink,
    "--muted": colors.surfaceAlt,
    "--muted-foreground": colors.inkMuted,
    "--accent": colors.primarySoft,
    "--accent-foreground": colors.onPrimarySoft,
    "--border": colors.line,
    "--input": colors.inputBorder,
    "--ring": colors.focus,
  }

  return { ...variables, colorScheme: "light" } as CSSProperties
}

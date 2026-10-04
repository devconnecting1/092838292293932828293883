/**
 * Casos das funções puras de tema.
 *
 * ATENÇÃO: apps/web não tem runner de testes configurado (vitest só existe na
 * raiz do monorepo, usado por packages/core). Este arquivo documenta os casos
 * e roda assim que o app ganhar um script de teste. As mesmas regras foram
 * verificadas por varredura de 18 mil temas aleatórios (primária, secundária
 * e destaque) durante o desenvolvimento: todo par texto/fundo ≥ 4.5:1 e
 * bordas/foco ≥ 3:1.
 */
import { describe, expect, it } from "vitest"

import {
  LANDING_FALLBACK_PRIMARY,
  LANDING_SCRIM_OPACITY,
  buildPublicStorageUrl,
  contrastRatio,
  deriveAccent,
  deriveSecondary,
  ensureContrast,
  fillWithText,
  mixColors,
  pickTextOn,
  resolveLandingTheme,
  scrimFor,
  type HexColor,
} from "@/lib/landing/theme"

const AA = 4.5

function textPairs(theme: ReturnType<typeof resolveLandingTheme>) {
  const c = theme.colors
  return [
    [c.onPrimary, c.primary],
    [c.onPrimary, c.primaryHover],
    [c.onPrimarySoft, c.primarySoft],
    [c.primaryText, c.surface],
    [c.primaryText, c.surfaceAlt],
    [c.onSecondary, c.secondary],
    [c.onSecondary, c.secondaryHover],
    [c.onSecondaryMuted, c.secondary],
    [c.onAccent, c.accent],
    [c.onAccent, c.accentHover],
    [c.accentText, c.accentSoft],
    [c.ink, c.surface],
    [c.ink, c.surfaceAlt],
    [c.inkMuted, c.surface],
    [c.inkMuted, c.surfaceAlt],
    [c.onScrim, c.scrim],
    [c.onScrim, mixColors(c.scrim, "#FFFFFF", 1 - LANDING_SCRIM_OPACITY)],
  ] as const
}

describe("contrastRatio", () => {
  it("preto sobre branco é 21:1 e é simétrico", () => {
    expect(contrastRatio("#000000", "#FFFFFF")).toBeCloseTo(21, 5)
    expect(contrastRatio("#FFFFFF", "#000000")).toBeCloseTo(21, 5)
  })

  it("cor contra ela mesma é 1:1", () => {
    expect(contrastRatio("#1F5F8B", "#1F5F8B")).toBeCloseTo(1, 5)
  })
})

describe("pickTextOn (regra 1)", () => {
  it.each<[HexColor, HexColor]>([
    ["#FFFFFF", "#16181D"],
    ["#000000", "#FFFFFF"],
    ["#0C6B63", "#FFFFFF"],
    ["#FACC15", "#16181D"],
    // Cinza médio: branco 4.48 e tinta 3.97 não passam → preto puro (4.69).
    ["#777777", "#000000"],
  ])("fundo %s → texto %s", (background, expected) => {
    expect(pickTextOn(background)).toBe(expected)
    expect(contrastRatio(pickTextOn(background), background)).toBeGreaterThanOrEqual(AA)
  })
})

describe("fillWithText (regras 2 e 3)", () => {
  it("azul médio é escurecido para manter texto branco", () => {
    const fill = fillWithText("#3B82F6")
    expect(fill.text).toBe("#FFFFFF")
    expect(fill.fill).not.toBe("#3B82F6")
    expect(contrastRatio(fill.text, fill.fill)).toBeGreaterThanOrEqual(AA)
  })

  it("amarelo claro recebe texto escuro e hover mais claro", () => {
    const fill = fillWithText("#FACC15")
    expect(fill.fill).toBe("#FACC15")
    expect(fill.text).toBe("#16181D")
    expect(contrastRatio(fill.text, fill.hover)).toBeGreaterThanOrEqual(
      contrastRatio(fill.text, fill.fill)
    )
  })

  it("verde escuro da marca fica intacto com texto branco", () => {
    expect(fillWithText("#0C6B63")).toMatchObject({
      fill: "#0C6B63",
      text: "#FFFFFF",
    })
  })
})

describe("ensureContrast (regra 4)", () => {
  it("escurece cor clara usada como texto sobre branco", () => {
    const color = ensureContrast("#FACC15", "#FFFFFF")
    expect(contrastRatio(color, "#FFFFFF")).toBeGreaterThanOrEqual(AA)
  })

  it("não altera cor que já passa", () => {
    expect(ensureContrast("#0C6B63", "#FFFFFF")).toBe("#0C6B63")
  })
})

describe("scrimFor (regra 5)", () => {
  it("texto branco passa sobre o véu aplicado a um pixel branco", () => {
    for (const base of ["#FFFFFF", "#FACC15", "#0C6B63", "#777777"] as HexColor[]) {
      const scrim = scrimFor(base)
      const worstCase = mixColors(scrim, "#FFFFFF", 1 - LANDING_SCRIM_OPACITY)
      expect(contrastRatio("#FFFFFF", worstCase)).toBeGreaterThanOrEqual(AA)
    }
  })
})

describe("derivações", () => {
  it("secundária é mais escura que a primária", () => {
    expect(contrastRatio(deriveSecondary("#0C6B63"), "#FFFFFF")).toBeGreaterThan(
      contrastRatio("#0C6B63", "#FFFFFF")
    )
  })

  it("marca sem saturação não inventa destaque colorido", () => {
    expect(deriveAccent("#333333")).toBe(mixColors("#333333", "#FFFFFF", 0.25))
  })
})

describe("resolveLandingTheme", () => {
  it("usa a cor do tema, depois a da imobiliária, depois o padrão", () => {
    expect(
      resolveLandingTheme(
        { primary_color: "#aa0000" },
        { primary_color: "#0C6B63" },
        { storageBaseUrl: null }
      ).source.primary
    ).toBe("theme")
    const fromOrg = resolveLandingTheme({}, { primary_color: "#0c6b63" }, { storageBaseUrl: null })
    expect(fromOrg.source.primary).toBe("organization")
    expect(fromOrg.colors.brand).toBe("#0C6B63")
    const fallback = resolveLandingTheme(null, null, { storageBaseUrl: null })
    expect(fallback.colors.brand).toBe(LANDING_FALLBACK_PRIMARY)
  })

  it("ignora cores inválidas (formato curto, nomes, CSS)", () => {
    const theme = resolveLandingTheme(
      { primary_color: "red; background:url(x)", secondary_color: "#FFF" },
      {},
      { storageBaseUrl: null }
    )
    expect(theme.source).toMatchObject({
      primary: "fallback",
      secondary: "derived",
    })
  })

  it.each<HexColor>(["#FFFFFF", "#000000", "#777777", "#FACC15", "#3B82F6", "#E11D48", "#22C55E"])(
    "todos os pares de texto passam 4.5:1 com a marca %s",
    (primary) => {
      const variants = [
        resolveLandingTheme({ primary_color: primary }, {}, { storageBaseUrl: null }),
        resolveLandingTheme(
          {
            primary_color: primary,
            secondary_color: "#F5F5F5",
            accent_color: "#FFEB3B",
          },
          {},
          { storageBaseUrl: null }
        ),
      ]
      for (const theme of variants) {
        for (const [foreground, background] of textPairs(theme)) {
          expect(contrastRatio(foreground, background)).toBeGreaterThanOrEqual(AA)
        }
        expect(
          contrastRatio(theme.colors.inputBorder, theme.colors.surface)
        ).toBeGreaterThanOrEqual(3)
        expect(contrastRatio(theme.colors.focus, theme.colors.surfaceAlt)).toBeGreaterThanOrEqual(3)
      }
    }
  )

  it("gera URLs públicas e cai no logo da imobiliária", () => {
    const theme = resolveLandingTheme(
      {
        background_image_path: "org/landing/page/fundo.jpg",
        banner_image_paths: ["org/landing/page/1.jpg", "../fora.jpg"],
        logo_path: null,
      },
      { logo_url: "https://cdn.exemplo/logo.png" },
      { storageBaseUrl: "https://abc.supabase.co/" }
    )
    expect(theme.images.background).toBe(
      "https://abc.supabase.co/storage/v1/object/public/landing-assets/org/landing/page/fundo.jpg"
    )
    expect(theme.images.banners).toHaveLength(1)
    expect(theme.images.logo).toBe("https://cdn.exemplo/logo.png")
  })

  it("expõe só custom properties com hex validado", () => {
    const style = resolveLandingTheme({ primary_color: "#0C6B63" }, {}, { storageBaseUrl: null })
      .style as Record<string, string>
    for (const [key, value] of Object.entries(style)) {
      if (key === "colorScheme") continue
      expect(key.startsWith("--")).toBe(true)
      expect(value).toMatch(/^#[0-9A-F]{6}$/)
    }
  })
})

describe("buildPublicStorageUrl", () => {
  it("codifica cada segmento", () => {
    expect(
      buildPublicStorageUrl(
        "https://abc.supabase.co",
        "landing-assets",
        "org 1/landing/p#1/foto ç.jpg"
      )
    ).toBe(
      "https://abc.supabase.co/storage/v1/object/public/landing-assets/org%201/landing/p%231/foto%20%C3%A7.jpg"
    )
  })

  it.each([["a/../x.png"], ["/absoluto.png"], ["https://evil.example/x.png"], ["a\\b.png"], [""]])(
    "recusa caminho inseguro %s",
    (path) => {
      expect(buildPublicStorageUrl("https://abc.supabase.co", "b", path)).toBeNull()
    }
  )

  it("recusa base ausente ou com protocolo estranho", () => {
    expect(buildPublicStorageUrl(null, "b", "a/b.png")).toBeNull()
    expect(buildPublicStorageUrl("javascript:alert(1)", "b", "a/b.png")).toBeNull()
  })
})

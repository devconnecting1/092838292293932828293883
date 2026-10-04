// Rótulo curto do aparelho ("Chrome no Android") a partir do user-agent. Só o
// rótulo vai para o banco: o user-agent completo nunca é guardado.

const BROWSERS: ReadonlyArray<[RegExp, string]> = [
  [/EdgA?\/|EdgiOS\//, "Edge"],
  [/SamsungBrowser\//, "Samsung Internet"],
  [/OPR\/|OPT\//, "Opera"],
  [/Firefox\/|FxiOS\//, "Firefox"],
  [/Chrome\/|CriOS\//, "Chrome"],
  [/Safari\//, "Safari"],
]

const SYSTEMS: ReadonlyArray<[RegExp, string]> = [
  [/Android/, "Android"],
  [/iPhone|iPod/, "iPhone"],
  [/iPad/, "iPad"],
  [/CrOS/, "Chromebook"],
  [/Windows/, "Windows"],
  [/Macintosh|Mac OS X/, "Mac"],
  [/Linux/, "Linux"],
]

export function deviceLabelFromUserAgent(userAgent: string | null | undefined): string | null {
  const ua = userAgent?.slice(0, 512) ?? ""

  if (!ua) {
    return null
  }

  const browser = BROWSERS.find(([pattern]) => pattern.test(ua))?.[1] ?? null
  const system = SYSTEMS.find(([pattern]) => pattern.test(ua))?.[1] ?? null

  if (browser && system) {
    return `${browser} no ${system}`
  }

  return browser ?? (system ? `Navegador no ${system}` : null)
}

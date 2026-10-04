// Cookies first-party das landing pages, lidos e gravados no navegador.
// Só chame em efeitos e handlers (no servidor não fazem nada).

import { LANDING_COOKIE_PATH } from "@/lib/leads-publicos/constants"

export function readBrowserCookie(name: string): string | null {
  if (typeof document === "undefined") return null

  const prefix = `${name}=`
  const entry = document.cookie
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(prefix))

  if (!entry) return null

  try {
    return decodeURIComponent(entry.slice(prefix.length))
  } catch {
    return null
  }
}

export function readJsonCookie(name: string): unknown {
  const raw = readBrowserCookie(name)

  if (!raw) return null

  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

/** Grava com Path=/lp, SameSite=Lax e Secure em https. `maxAgeSeconds` 0 apaga. */
export function writeBrowserCookie(name: string, value: string, maxAgeSeconds: number) {
  if (typeof document === "undefined") return

  const secure = window.location.protocol === "https:" ? "; Secure" : ""

  document.cookie = `${name}=${encodeURIComponent(value)}; Max-Age=${maxAgeSeconds}; Path=${LANDING_COOKIE_PATH}; SameSite=Lax${secure}`
}

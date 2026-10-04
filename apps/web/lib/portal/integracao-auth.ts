import "server-only"

import { timingSafeEqual } from "node:crypto"

/** Comparação de segredo em tempo constante; segredo curto (< 24) nunca vale. */
export function segredoConfere(recebido: string | null | undefined, esperado: string | undefined) {
  const want = esperado?.trim() ?? ""
  if (want.length < 24 || !recebido) return false
  const a = Buffer.from(recebido)
  const b = Buffer.from(want)
  return a.length === b.length && timingSafeEqual(a, b)
}

/** Token das integrações do portal: PORTAL_LEADS_TOKEN, ou o do feed se não houver. */
export function tokenPortal() {
  return process.env.PORTAL_LEADS_TOKEN?.trim() || process.env.PORTAL_FEED_TOKEN?.trim() || ""
}

/** Senha do padrão Basic (usuario:SECRET_KEY) usado pelo Grupo OLX. */
export function senhaBasic(header: string | null) {
  if (!header?.startsWith("Basic ")) return null
  try {
    const dec = Buffer.from(header.slice(6).trim(), "base64").toString("utf8")
    const i = dec.indexOf(":")
    return i >= 0 ? dec.slice(i + 1) : null
  } catch {
    return null
  }
}

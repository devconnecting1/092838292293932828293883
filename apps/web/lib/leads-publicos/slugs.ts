// Normalização dos segmentos /lp/[org]/[page]. Sem `server-only`: o formulário
// também usa. A validação definitiva é das próprias RPCs.

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

function normalizeSlug(value: string, minLength: number, maxLength: number) {
  let decoded: string

  try {
    decoded = decodeURIComponent(value)
  } catch {
    return null
  }

  const slug = decoded.trim().toLowerCase()

  return slug.length >= minLength && slug.length <= maxLength && SLUG_PATTERN.test(slug)
    ? slug
    : null
}

/** Mesmas regras do slug da imobiliária em /captar (3 a 48 caracteres). */
export function normalizeOrgSlug(value: string) {
  return normalizeSlug(value, 3, 48)
}

export function normalizePageSlug(value: string) {
  return normalizeSlug(value, 1, 120)
}

/**
 * Escopo do token antirrobô (lib/captacao/anti-bot.ts). O prefixo e os ":"
 * impedem reaproveitar um token de /captar/[slug] aqui e vice-versa.
 */
export function landingTokenScope(orgSlug: string, pageSlug: string) {
  return `lp:${orgSlug}:${pageSlug}`
}

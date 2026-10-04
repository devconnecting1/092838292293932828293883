import {
  LANDING_SLUG_MAX_LENGTH,
  LANDING_SLUG_MIN_LENGTH,
  LANDING_SLUG_PATTERN,
} from "@/lib/marketing/constants"

/** Converte um texto livre em slug: sem acentos, minúsculo, com hífens. */
export function slugify(value: string, maxLength = LANDING_SLUG_MAX_LENGTH) {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, maxLength)
    .replace(/-+$/g, "")
}

export function isValidLandingSlug(value: string) {
  return (
    value.length >= LANDING_SLUG_MIN_LENGTH &&
    value.length <= LANDING_SLUG_MAX_LENGTH &&
    LANDING_SLUG_PATTERN.test(value)
  )
}

/** Mensagem pt-BR do problema do slug, ou null se estiver válido. */
export function describeSlugProblem(value: string) {
  if (value.length < LANDING_SLUG_MIN_LENGTH) {
    return `O endereço precisa ter pelo menos ${LANDING_SLUG_MIN_LENGTH} caracteres.`
  }
  if (value.length > LANDING_SLUG_MAX_LENGTH) {
    return `O endereço pode ter no máximo ${LANDING_SLUG_MAX_LENGTH} caracteres.`
  }
  if (!LANDING_SLUG_PATTERN.test(value)) {
    return "Use só letras minúsculas sem acento, números e hífens (sem hífen no começo ou no fim)."
  }
  return null
}

/**
 * Slug livre a partir de uma base, evitando os já usados: "base", "base-2",
 * "base-3"...
 */
export function uniqueSlug(base: string, taken: ReadonlySet<string>) {
  const normalized = slugify(base) || "landing-page"
  const padded = normalized.length < LANDING_SLUG_MIN_LENGTH ? `${normalized}-lp` : normalized

  if (!taken.has(padded)) return padded

  for (let suffix = 2; suffix < 1000; suffix += 1) {
    const tail = `-${suffix}`
    const candidate = `${padded.slice(0, LANDING_SLUG_MAX_LENGTH - tail.length).replace(/-+$/g, "")}${tail}`
    if (!taken.has(candidate)) return candidate
  }

  return `${padded.slice(0, LANDING_SLUG_MAX_LENGTH - 9)}-${crypto.randomUUID().slice(0, 8)}`
}

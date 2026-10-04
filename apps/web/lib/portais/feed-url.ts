// Endereços do feed VRSync e das fotos públicas. Módulo puro: sem env, sem I/O.

/** Bucket público lido pelos portais ao baixar as fotos do feed. */
export const PROPERTY_MEDIA_BUCKET = "property-media"

/** Formato de organizations.feed_token (24 bytes aleatórios em hex). */
export const FEED_TOKEN_PATTERN = /^[0-9a-f]{48}$/

/** Mesmo formato do check organizations_slug_format. */
export const ORGANIZATION_SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/

export function isFeedToken(value: string | null | undefined): value is string {
  return typeof value === "string" && FEED_TOKEN_PATTERN.test(value)
}

export function isOrganizationSlug(value: string | null | undefined): value is string {
  return (
    typeof value === "string" &&
    value.length >= 3 &&
    value.length <= 60 &&
    ORGANIZATION_SLUG_PATTERN.test(value)
  )
}

// A URL cadastrada no Canal Pro (ZAP, Viva Real e OLX) fica no subdomínio da
// imobiliária: buildPortalFeedUrl em lib/tenant/urls.ts. O caminho antigo
// /api/feeds/<slug>/vrsync.xml no domínio raiz continua respondendo.

/** URL pública de um arquivo do bucket property-media. */
export function buildPublicMediaUrl(supabaseUrl: string, storagePath: string) {
  const base = supabaseUrl.replace(/\/+$/, "")
  const path = storagePath
    .replace(/^\/+/, "")
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/")

  return `${base}/storage/v1/object/public/${PROPERTY_MEDIA_BUCKET}/${path}`
}

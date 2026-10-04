import { isUuid } from "@/lib/imoveis/ids"
import { LANDING_ACCEPTED_IMAGE_TYPES, LANDING_ASSETS_BUCKET } from "@/lib/marketing/constants"
import { getSupabaseEnv } from "@/lib/supabase/env"

const EXTENSIONS = new Set(Object.values(LANDING_ACCEPTED_IMAGE_TYPES))

/**
 * URL pública de um arquivo do bucket landing-assets (bucket público).
 * Funciona no servidor e no navegador.
 */
export function getLandingAssetPublicUrl(storagePath: string | null | undefined) {
  if (!storagePath) return null
  const env = getSupabaseEnv()
  if (!env) return null

  const base = env.url.replace(/\/+$/, "")
  const encodedPath = storagePath.split("/").map(encodeURIComponent).join("/")

  return `${base}/storage/v1/object/public/${LANDING_ASSETS_BUCKET}/${encodedPath}`
}

export function landingAssetFolder(organizationId: string, pageId: string) {
  return `${organizationId}/landing/${pageId}/`
}

/** Caminho no formato {organization_id}/landing/{page_id}/{uuid}.{ext}. */
export function isLandingAssetPath(
  path: unknown,
  organizationId: string,
  pageId: string
): path is string {
  if (typeof path !== "string") return false
  const prefix = landingAssetFolder(organizationId, pageId)
  if (!path.startsWith(prefix)) return false

  const match = /^([0-9a-f-]{36})\.([a-z]+)$/i.exec(path.slice(prefix.length))
  return Boolean(match && isUuid(match[1]) && EXTENSIONS.has((match[2] ?? "").toLowerCase()))
}

/** Caminhos de landing-assets de qualquer página da imobiliária (para duplicar). */
export function isOrganizationLandingAssetPath(
  path: unknown,
  organizationId: string
): path is string {
  if (typeof path !== "string") return false
  const match = new RegExp(`^${organizationId}/landing/([0-9a-f-]{36})/`, "i").exec(path)
  return Boolean(match && isLandingAssetPath(path, organizationId, match[1] ?? ""))
}

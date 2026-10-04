import { getSupabaseEnv } from "@/lib/supabase/env"

import { PROPERTY_MEDIA_BUCKET } from "@/lib/imoveis/constants"

/**
 * URL pública de um arquivo do bucket property-media (bucket público: leitura
 * sem RLS). Funciona no servidor e no navegador.
 */
export function getPropertyMediaPublicUrl(storagePath: string | null | undefined) {
  if (!storagePath) return null
  const env = getSupabaseEnv()
  if (!env) return null

  const base = env.url.replace(/\/+$/, "")
  const encodedPath = storagePath.split("/").map(encodeURIComponent).join("/")

  return `${base}/storage/v1/object/public/${PROPERTY_MEDIA_BUCKET}/${encodedPath}`
}

import { createClient, type SupabaseClient } from "@supabase/supabase-js"

import { getSupabaseEnv, SupabaseNotConfiguredError } from "@/lib/supabase/env"
import type { SignedUploadTicket } from "@/lib/storage/signed-upload-ticket"

let storageOnlyClient: SupabaseClient | null = null

/**
 * Cliente do navegador SEM sessão: `accessToken` desliga o Supabase Auth (nada
 * de cookies, localStorage ou renovação de token). Serve só para enviar com o
 * token de uma URL assinada criada no servidor.
 */
function getStorageOnlyClient() {
  if (storageOnlyClient) return storageOnlyClient

  const env = getSupabaseEnv()

  if (!env) {
    throw new SupabaseNotConfiguredError()
  }

  storageOnlyClient = createClient(env.url, env.publishableKey, {
    accessToken: async () => null,
  })

  return storageOnlyClient
}

export type SignedUploadError = {
  message: string
  statusCode?: string | number
  status?: string | number
}

/**
 * Envia o arquivo com o token (uploadToSignedUrl). Com Blob o supabase-js manda
 * multipart e o tipo gravado é o do próprio Blob: por isso o Blob é rotulado com
 * `contentType` (um PDF escolhido no celular pode vir com `type` vazio). O
 * bucket confere tipo e tamanho; o servidor confere de novo ao registrar.
 */
export async function uploadWithTicket(
  bucket: string,
  ticket: SignedUploadTicket,
  body: Blob,
  { contentType, cacheControl }: { contentType: string; cacheControl?: string }
): Promise<{ error: SignedUploadError | null }> {
  const labeled = body.type === contentType ? body : body.slice(0, body.size, contentType)

  const { error } = await getStorageOnlyClient()
    .storage.from(bucket)
    .uploadToSignedUrl(ticket.path, ticket.token, labeled, {
      contentType,
      ...(cacheControl ? { cacheControl } : {}),
    })

  if (!error) return { error: null }

  const details = error as { statusCode?: string | number; status?: string | number }

  return {
    error: { message: error.message, statusCode: details.statusCode, status: details.status },
  }
}

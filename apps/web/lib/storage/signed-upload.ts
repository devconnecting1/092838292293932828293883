import "server-only"

import {
  checkUploadedObject,
  type UploadedObjectCheck,
  type UploadedObjectRules,
} from "@workspace/core/media/uploaded-object"

import { isStorageForbiddenError } from "@/lib/media/upload-errors"
import type { SignedUploadTicket } from "@/lib/storage/signed-upload-ticket"
import type { createClient } from "@/lib/supabase/server"

type ServerSupabaseClient = Awaited<ReturnType<typeof createClient>>

export type SignedUploadResult =
  { ok: true; ticket: SignedUploadTicket } | { ok: false; forbidden: boolean }

/**
 * Autoriza o envio de UM arquivo, no caminho escolhido pelo servidor.
 *
 * O Storage testa o INSERT com o RLS do usuário da sessão ao gerar o token e
 * grava o dono (owner_id) no token. O envio com o token (feito pelo navegador,
 * sem sessão) não passa de novo pelo RLS, mas continua preso ao caminho, ao
 * limite de tamanho e aos tipos do bucket. Validade: 2 horas no Supabase
 * (https://supabase.com/docs/reference/javascript/file-buckets-createsigneduploadurl).
 * Por isso o token é pedido só depois da otimização, imediatamente antes do envio.
 */
export async function createSignedUpload(
  supabase: ServerSupabaseClient,
  bucket: string,
  path: string
): Promise<SignedUploadResult> {
  const { data, error } = await supabase.storage.from(bucket).createSignedUploadUrl(path)

  if (error || !data?.token) {
    const forbidden = isStorageForbiddenError(error)

    if (!forbidden) {
      // Sem o caminho no log: em documentos de clientes ele contém o nome do arquivo.
      console.error("[storage] falha ao autorizar envio:", error?.name ?? "sem token")
    }

    return { ok: false, forbidden }
  }

  return { ok: true, ticket: { path, token: data.token } }
}

/**
 * Lê no bucket o tamanho e o tipo gravados (não os informados pelo navegador)
 * e confere as regras. Exige permissão de leitura (SELECT) no objeto.
 */
export async function inspectUploadedObject(
  supabase: ServerSupabaseClient,
  bucket: string,
  path: string,
  rules: UploadedObjectRules
): Promise<UploadedObjectCheck> {
  const { data, error } = await supabase.storage.from(bucket).info(path)

  if (error || !data) {
    return checkUploadedObject(null, rules)
  }

  return checkUploadedObject({ size: data.size, contentType: data.contentType }, rules)
}

/** Apaga arquivos enviados que não chegaram a ser registrados (melhor esforço). */
export async function removeUnregisteredUploads(
  supabase: ServerSupabaseClient,
  bucket: string,
  paths: readonly string[]
): Promise<void> {
  if (paths.length === 0) return

  const { error } = await supabase.storage.from(bucket).remove([...paths])

  if (error) {
    console.error("[storage] envio sem registro ficou no bucket:", error.name)
  }
}

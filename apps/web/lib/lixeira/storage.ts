import "server-only"

import type { createClient } from "@/lib/supabase/server"

type ServerClient = Awaited<ReturnType<typeof createClient>>

/** Arquivos por chamada de remove (a Storage API aceita lotes). */
const REMOVE_BATCH = 100

/** Padrão ao abrir a Lixeira; o Painel passa um lote menor (roda depois da resposta). */
const DEFAULT_LIMIT = 500

/**
 * Remove do Storage os arquivos de registros já apagados ou anonimizados.
 *
 * O banco não apaga arquivo (storage.protect_delete): as funções da lixeira e a
 * rotina diária põem o caminho em private.storage_purge_queue. Aqui a sessão de
 * dono/gerente lê a fila, remove pela Storage API (políticas "lixeira: dono e
 * gerente ... fila de remoção") e baixa da fila o que sumiu. Sem service_role.
 * Falha não interrompe quem chamou: a fila continua e sai na próxima vez.
 *
 * Chamada ao abrir a Lixeira e, com lote pequeno, dentro de `after()` ao abrir o
 * Painel (dono/gerente), para a fila não depender de alguém visitar a Lixeira.
 */
export async function drainStoragePurgeQueue(
  supabase: ServerClient,
  organizationId: string,
  { limit = DEFAULT_LIMIT }: { limit?: number } = {}
) {
  const { data, error } = await supabase.rpc("list_storage_purge_queue", {
    p_organization_id: organizationId,
    p_limit: limit,
  })

  if (error || !data || data.length === 0) {
    return 0
  }

  const byBucket = new Map<string, string[]>()
  for (const item of data) {
    const paths = byBucket.get(item.bucket_id) ?? []
    paths.push(item.object_path)
    byBucket.set(item.bucket_id, paths)
  }

  for (const [bucket, paths] of byBucket) {
    for (let start = 0; start < paths.length; start += REMOVE_BATCH) {
      const { error: removeError } = await supabase.storage
        .from(bucket)
        .remove(paths.slice(start, start + REMOVE_BATCH))

      if (removeError) {
        // Só contagem: o caminho não tem dado pessoal, mas o log não precisa dele.
        console.error("[lixeira] falha ao remover arquivos do Storage", {
          bucket,
          quantidade: Math.min(REMOVE_BATCH, paths.length - start),
        })
      }
    }
  }

  const { data: settled } = await supabase.rpc("settle_storage_purge_queue", {
    p_organization_id: organizationId,
  })

  return settled ?? 0
}

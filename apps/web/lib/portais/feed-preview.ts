import "server-only"

import { APP_NAME } from "@/components/crm/brand"
import { translateDatabaseError } from "@/lib/configuracoes/errors"
import { buildPortalFeed, type PortalFeedResult } from "@/lib/portais/vrsync-mapper"
import { getSupabaseEnv } from "@/lib/supabase/env"
import type { createClient } from "@/lib/supabase/server"

export type FeedPreviewState =
  | {
      status: "ok"
      result: Pick<PortalFeedResult, "total" | "included" | "skipped" | "headerIssues">
    }
  | { status: "error"; message: string }

/**
 * Monta a prévia com a MESMA RPC e o mesmo mapeamento do feed público, usando
 * a sessão do usuário (a RPC também é liberada para authenticated).
 */
export async function loadFeedPreview(
  supabase: Awaited<ReturnType<typeof createClient>>,
  slug: string,
  feedToken: string
): Promise<FeedPreviewState> {
  const env = getSupabaseEnv()

  if (!env) {
    return {
      status: "error",
      message: "O Supabase não está configurado neste ambiente.",
    }
  }

  const { data, error } = await supabase.rpc("get_portal_feed", {
    p_org_slug: slug,
    p_token: feedToken,
  })

  if (error) {
    return {
      status: "error",
      message: translateDatabaseError(error, "Não foi possível montar a prévia do feed agora."),
    }
  }

  if (data === null) {
    return {
      status: "error",
      message: "O endereço do feed acabou de mudar. Recarregue a página para ver a prévia.",
    }
  }

  const result = buildPortalFeed(data, {
    supabaseUrl: env.url,
    provider: APP_NAME,
  })

  if (!result) {
    return {
      status: "error",
      message: "O feed respondeu num formato inesperado. Verifique as migrações do banco.",
    }
  }

  return {
    status: "ok",
    result: {
      total: result.total,
      included: result.included,
      skipped: result.skipped,
      headerIssues: result.headerIssues,
    },
  }
}

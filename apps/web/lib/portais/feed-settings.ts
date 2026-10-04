import "server-only"

import type { Role } from "@/lib/auth/roles"
import { translateDatabaseError } from "@/lib/configuracoes/errors"
import { isFeedToken, isOrganizationSlug } from "@/lib/portais/feed-url"
import type { createClient } from "@/lib/supabase/server"

/**
 * Quem pode ler o endereço do feed (RPC get_feed_settings). O token não é
 * mais legível por SELECT em organizations: a RPC é a única fonte.
 */
export const FEED_SETTINGS_ROLES: readonly Role[] = ["owner", "manager"]

export type FeedSettingsState =
  | { status: "ok"; slug: string; feedToken: string }
  /** Papel sem acesso ao endereço do feed (ex.: financeiro). Não é erro. */
  | { status: "forbidden" }
  | { status: "error"; message: string }

export function canViewFeedSettings(role: Role) {
  return FEED_SETTINGS_ROLES.includes(role)
}

/** Lê `{ slug, feed_token }` pela RPC; 42501 vira `forbidden`, sem erro na tela. */
export async function loadFeedSettings(
  supabase: Awaited<ReturnType<typeof createClient>>,
  organizationId: string,
  role: Role
): Promise<FeedSettingsState> {
  if (!canViewFeedSettings(role)) {
    return { status: "forbidden" }
  }

  const { data, error } = await supabase.rpc("get_feed_settings", {
    p_organization_id: organizationId,
  })

  if (error) {
    if (error.code === "42501") {
      return { status: "forbidden" }
    }

    // Só o código: nada de token no log.
    console.error(`[portais] get_feed_settings falhou: ${error.code ?? "erro"}`)

    return {
      status: "error",
      message: translateDatabaseError(error, "Não foi possível carregar o endereço do feed agora."),
    }
  }

  const value = data && typeof data === "object" && !Array.isArray(data) ? data : null
  const slug = value?.slug
  const feedToken = value?.feed_token

  if (
    typeof slug !== "string" ||
    !isOrganizationSlug(slug) ||
    typeof feedToken !== "string" ||
    !isFeedToken(feedToken)
  ) {
    return {
      status: "error",
      message:
        "O endereço do feed respondeu num formato inesperado. Verifique as migrações do banco.",
    }
  }

  return { status: "ok", slug, feedToken }
}

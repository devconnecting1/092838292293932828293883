import type { NextRequest } from "next/server"

import { APP_NAME } from "@/components/crm/brand"
import { isFeedToken, isOrganizationSlug } from "@/lib/portais/feed-url"
import { createAnonClient } from "@/lib/portais/supabase-anon"
import { buildPortalFeed } from "@/lib/portais/vrsync-mapper"
import { getSupabaseEnv } from "@/lib/supabase/env"

/**
 * Feed VRSync lido pelo Canal Pro do Grupo OLX (ZAP Imóveis, Viva Real, OLX).
 * URLs:
 * - atual: https://<slug>.<raiz>/api/feeds/vrsync.xml?token=<feed_token>
 *   (o proxy reescreve para esta rota com o slug do subdomínio);
 * - antiga, por compatibilidade: https://<raiz>/api/feeds/<slug>/vrsync.xml?token=...
 *   Continua respondendo 200 sem redirecionar: os robôs dos portais leem a URL
 *   já cadastrada e não é garantido que sigam redirecionamentos.
 *
 * Rota pública e sem sessão. O acesso é decidido pela RPC
 * get_portal_feed, que devolve null para slug inexistente ou token errado,
 * sem distinguir os casos. Anúncios que não passam na validação ficam fora
 * do XML sem derrubar o feed; a prévia em /configuracoes/imobiliaria mostra
 * o motivo.
 */

const ERROR_HEADERS = {
  "Cache-Control": "no-store",
  "X-Robots-Tag": "noindex",
}

function emptyResponse(status: number, extraHeaders: Record<string, string> = {}) {
  return new Response(null, {
    status,
    headers: { ...ERROR_HEADERS, ...extraHeaders },
  })
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const env = getSupabaseEnv()

  if (!env) {
    return emptyResponse(503)
  }

  const { slug: rawSlug } = await params
  const slug = rawSlug.trim().toLowerCase()
  const token = request.nextUrl.searchParams.get("token")

  if (!isOrganizationSlug(slug) || !isFeedToken(token)) {
    return emptyResponse(404)
  }

  const supabase = createAnonClient(env)
  const { data, error } = await supabase.rpc("get_portal_feed", {
    p_org_slug: slug,
    p_token: token,
  })

  if (error) {
    // Só o código: nada de slug, token ou dados no log.
    console.error(`[feeds/vrsync] get_portal_feed falhou: ${error.code ?? "erro"}`)
    return emptyResponse(503, { "Retry-After": "300" })
  }

  if (data === null) {
    return emptyResponse(404)
  }

  const feed = buildPortalFeed(data, {
    supabaseUrl: env.url,
    provider: APP_NAME,
  })

  if (!feed) {
    console.error("[feeds/vrsync] get_portal_feed respondeu num formato inesperado")
    return emptyResponse(503, { "Retry-After": "300" })
  }

  return new Response(feed.xml, {
    status: 200,
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      // Sem cache compartilhado: a URL carrega o token do feed e os portais só
      // baixam o XML duas vezes ao dia. Um CDN/proxy não deve guardar a resposta.
      "Cache-Control": "private, no-store",
      "X-Robots-Tag": "noindex",
    },
  })
}

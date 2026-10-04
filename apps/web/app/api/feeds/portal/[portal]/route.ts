import { timingSafeEqual } from "node:crypto"

import type { NextRequest } from "next/server"
import { createClient } from "@supabase/supabase-js"

import { montarFeed } from "@/lib/portal/feed-portais"
import { toPortalListing } from "@/lib/portal/imoveis"
import { getSupabaseEnv } from "@/lib/supabase/env"

/**
 * Feed dos anúncios pagos e aprovados do portal, no formato VRSync.
 * URL cadastrada no portal: /api/feeds/portal/<portal>?token=<PORTAL_FEED_TOKEN>
 * (portal = grupo-olx, imovelweb ou chaves-na-mao).
 */

const NO = { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" }

function tokenOk(got: string | null) {
  const want = process.env.PORTAL_FEED_TOKEN?.trim() ?? ""
  if (want.length < 24 || !got) return false
  const a = Buffer.from(got)
  const b = Buffer.from(want)
  return a.length === b.length && timingSafeEqual(a, b)
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ portal: string }> }
) {
  const { portal } = await params
  if (!/^[a-z0-9-]{2,40}$/.test(portal) || !tokenOk(request.nextUrl.searchParams.get("token"))) {
    return new Response(null, { status: 404, headers: NO })
  }
  const email =
    process.env.PORTAL_FEED_EMAIL?.trim() || process.env.NEXT_PUBLIC_SUPPORT_EMAIL?.trim()
  const env = getSupabaseEnv()
  if (!env || !email) return new Response(null, { status: 503, headers: NO })

  const supabase = createClient(env.url, env.publishableKey, { auth: { persistSession: false } })
  const { data, error } = await supabase.rpc("feed_portal", { p_portal: portal })
  if (error || !Array.isArray(data)) {
    console.error(`[feeds/portal] feed_portal falhou: ${error?.code ?? "formato"}`)
    return new Response(null, { status: 503, headers: { ...NO, "Retry-After": "300" } })
  }

  const feed = montarFeed((data as Record<string, unknown>[]).map(toPortalListing), email)
  return new Response(feed.xml, {
    status: 200,
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Cache-Control": "private, no-store",
      "X-Robots-Tag": "noindex",
      "X-Feed-Incluidos": String(feed.included.length),
      "X-Feed-Fora": String(feed.skipped.length),
    },
  })
}

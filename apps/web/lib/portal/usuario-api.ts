import "server-only"

import { createClient } from "@supabase/supabase-js"

import { getSupabaseEnv } from "@/lib/supabase/env"

/**
 * Confere o usuário do portal a partir do token de sessão enviado pelo navegador
 * (Authorization: Bearer <access_token>). Devolve o id e o perfil, ou null.
 */
export async function usuarioDoPedido(request: Request) {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "")
  const env = getSupabaseEnv()
  if (!token || !env) return null
  const sb = createClient(env.url, env.publishableKey, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  })
  const { data } = await sb.auth.getUser(token)
  if (!data.user) return null
  const { data: perfil } = await sb
    .from("perfis")
    .select("perfil, plano, plano_ate")
    .eq("user_id", data.user.id)
    .maybeSingle()
  const p = (perfil ?? {}) as { perfil?: string; plano?: string | null; plano_ate?: string | null }
  const planoAtivo =
    p.perfil === "admin"
      ? "premium"
      : p.plano && p.plano_ate && new Date(p.plano_ate).getTime() > Date.now()
        ? p.plano
        : "gratis"
  return { id: data.user.id, perfil: p.perfil ?? null, plano: planoAtivo, sb }
}

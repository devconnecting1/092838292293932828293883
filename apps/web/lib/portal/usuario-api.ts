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
    .select("*")
    .eq("user_id", data.user.id)
    .maybeSingle()
  const p = (perfil ?? {}) as {
    perfil?: string
    plano?: string | null
    plano_ate?: string | null
    status?: string | null
    creci_ok?: boolean | null
    parceria_aceite_em?: string | null
  }
  const planoAtivo =
    p.perfil === "admin"
      ? "premium"
      : p.plano &&
          p.plano !== "gratis" &&
          p.plano_ate &&
          new Date(p.plano_ate).getTime() > Date.now()
        ? p.plano
        : p.perfil === "corretor" && p.status === "aprovado" && p.creci_ok && p.parceria_aceite_em
          ? "profissional"
          : "gratis"
  return { id: data.user.id, perfil: p.perfil ?? null, plano: planoAtivo, sb }
}

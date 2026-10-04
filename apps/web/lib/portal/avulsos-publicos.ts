import { createClient } from "@supabase/supabase-js"

import { getSupabaseEnv } from "@/lib/supabase/env"

/** Anúncio de proprietário com plano no ar (vitrine pública /imoveis-a-venda). */
export type AvulsoPublico = {
  id: string
  finalidade: "venda" | "aluguel"
  valor_condominio: number | null
  valor_iptu: number | null
  tipo: string
  titulo: string
  descricao: string
  preco: number | null
  uf: string
  cidade: string
  bairro: string | null
  quartos: number | null
  vagas: number | null
  area: number | null
  fotos: string[]
  contato_nome: string
  contato_telefone: string
  no_ar_ate: string
}

export async function listarAvulsosPublicos(f: {
  uf?: string | null
  cidade?: string | null
  id?: string | null
  finalidade?: "venda" | "aluguel" | null
  quartos?: number | null
}): Promise<AvulsoPublico[]> {
  const env = getSupabaseEnv()
  if (!env) return []
  try {
    const sb = createClient(env.url, env.publishableKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    })
    const { data, error } = await sb.rpc("avulsos_publicos", {
      p_uf: f.uf || null,
      p_cidade: f.cidade || null,
      p_id: f.id || null,
      p_finalidade: f.finalidade || null,
      p_quartos: f.quartos || null,
    })
    if (error) return []
    return (data as AvulsoPublico[] | null) ?? []
  } catch {
    return []
  }
}

export function whatsDoDono(a: AvulsoPublico, url: string) {
  let n = a.contato_telefone.replace(/\D/g, "")
  if (n.length === 10 || n.length === 11) n = `55${n}`
  const msg = `Olá, ${a.contato_nome.split(" ")[0]}! Vi o seu anúncio "${a.titulo}" no Vamos Arrematar (${url}) e tenho interesse.`
  return `https://wa.me/${n}?text=${encodeURIComponent(msg)}`
}

export const brlInteiro = (v: number | null) =>
  v == null
    ? "Preço a combinar"
    : v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 })

export function precoAnuncio(a: Pick<AvulsoPublico, "preco" | "finalidade">) {
  return a.finalidade === "aluguel" && a.preco != null
    ? `${brlInteiro(a.preco)}/mês`
    : brlInteiro(a.preco)
}

export const ROTA_FINALIDADE = {
  venda: "/imoveis-a-venda",
  aluguel: "/imoveis-para-alugar",
} as const

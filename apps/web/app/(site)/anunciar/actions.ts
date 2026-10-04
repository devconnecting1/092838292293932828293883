"use server"

import { createClient } from "@supabase/supabase-js"

import { getPortalListing, origemNome, brl, tipoLabel } from "@/lib/portal/imoveis"
import { getSupabaseEnv } from "@/lib/supabase/env"

export type ItemResumo = {
  id: string
  titulo: string
  local: string
  preco: string
  origem: string
}

/** Resumo dos imóveis escolhidos (só imóveis ativos; ids inválidos somem). */
export async function resumirImoveis(ids: string[]): Promise<ItemResumo[]> {
  const unicos = [...new Set(ids)].filter((id) => /^[a-z0-9-]{1,80}$/.test(id)).slice(0, 200)
  const itens = await Promise.all(unicos.map((id) => getPortalListing(id)))
  return itens
    .filter((i) => i !== null)
    .map((i) => ({
      id: i.numero,
      titulo: `${tipoLabel(i.tipo)}${i.quartos ? ` ${i.quartos} quarto${i.quartos > 1 ? "s" : ""}` : ""}`,
      local: [i.bairro, `${i.cidade}/${i.uf}`].filter(Boolean).join(", "),
      preco: brl(i.preco),
      origem: origemNome(i.origem),
    }))
}

export type PedidoResultado =
  | { ok: true; codigo: string; valor: number | null; imoveis: number; dias: number }
  | { ok: false; erro: string }

export async function criarPedido(form: FormData): Promise<PedidoResultado> {
  const env = getSupabaseEnv()
  if (!env) return { ok: false, erro: "Serviço indisponível no momento." }
  const txt = (k: string) => String(form.get(k) ?? "").trim()
  const imoveis = txt("imoveis").split(",").filter(Boolean)
  const portais = form.getAll("portais").map(String)
  if (txt("site")) return { ok: false, erro: "Envio bloqueado." } // armadilha para robôs
  const supabase = createClient(env.url, env.publishableKey, { auth: { persistSession: false } })
  const { data, error } = await supabase.rpc("criar_pedido_anuncio", {
    p_nome: txt("nome"),
    p_email: txt("email"),
    p_telefone: txt("telefone"),
    p_perfil: txt("perfil"),
    p_creci: txt("creci"),
    p_imoveis: imoveis,
    p_portais: portais,
    p_consentimento: form.get("consentimento") === "on",
    p_aceite_termo: form.get("termo") === "on",
  })
  if (error || !data) {
    const msg = error?.message ?? ""
    const conhecido = [
      "perfil inválido",
      "informe o CRECI",
      "escolha ao menos um imóvel",
      "escolha ao menos um portal",
    ].find((m) => msg.includes(m))
    return {
      ok: false,
      erro: conhecido
        ? `Confira o pedido: ${conhecido}.`
        : "Não foi possível registrar o pedido. Confira os campos e tente de novo.",
    }
  }
  const d = data as { codigo: string; valor: number | null; imoveis: number; dias: number }
  return {
    ok: true,
    codigo: d.codigo,
    valor: d.valor === null ? null : Number(d.valor),
    imoveis: d.imoveis,
    dias: d.dias,
  }
}

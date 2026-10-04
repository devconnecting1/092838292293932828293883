import "server-only"

import { createClient } from "@supabase/supabase-js"

import { getSupabaseEnv } from "@/lib/supabase/env"

export type LeadPortal = {
  imovelId: string | null
  nome: string
  telefone: string | null
  email: string | null
  mensagem: string
  origem: "grupo-olx" | "imovelweb"
}

/**
 * Grava o contato que chegou de um portal na tabela `leads` do portal, para a
 * equipe atender. Usa a chave pública: a política `lead_cria` aceita inserção
 * com status "novo" e consentimento, que o portal de origem já colheu.
 * Se o código do imóvel não existir mais, grava sem o vínculo.
 */
export async function gravarLeadPortal(l: LeadPortal): Promise<boolean> {
  const env = getSupabaseEnv()
  if (!env) return false
  const sb = createClient(env.url, env.publishableKey, { auth: { persistSession: false } })
  const linha = {
    imovel_id: l.imovelId && /^[a-z0-9-]{1,80}$/.test(l.imovelId) ? l.imovelId : null,
    nome: l.nome.slice(0, 120) || "Contato do portal",
    telefone: (l.telefone ?? "").slice(0, 30) || "não informado",
    email: l.email?.slice(0, 160) || null,
    interesse: "visita",
    mensagem: l.mensagem.slice(0, 4000),
    consentimento: true,
    origem: l.origem,
    status: "novo",
  }
  let { error } = await sb.from("leads").insert(linha)
  if (error?.code === "23503")
    ({ error } = await sb.from("leads").insert({ ...linha, imovel_id: null }))
  if (error) console.error(`[leads-portais] ${l.origem}: falha ao gravar (${error.code ?? "?"})`)
  return !error
}

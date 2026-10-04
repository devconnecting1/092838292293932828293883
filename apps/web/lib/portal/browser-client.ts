"use client"

import { createClient, type SupabaseClient } from "@supabase/supabase-js"

import { getSupabaseEnv } from "@/lib/supabase/env"

/**
 * Cliente do Supabase no navegador para a área do corretor do portal.
 * Sessão própria (chave "va-auth"), separada do login do CRM. Quem decide o
 * que cada um lê ou altera é o RLS do banco, não esta tela.
 */
let cliente: SupabaseClient | null = null

export function portalBrowserClient() {
  if (cliente) return cliente
  const env = getSupabaseEnv()
  if (!env) return null
  cliente = createClient(env.url, env.publishableKey, {
    auth: { persistSession: true, autoRefreshToken: true, storageKey: "va-auth" },
  })
  return cliente
}

export const DOCS = [
  { campo: "doc_creci_path", rotulo: "Carteira do CRECI (frente e verso)" },
  { campo: "doc_residencia_path", rotulo: "Comprovante de residência" },
  { campo: "doc_certidao_estadual_path", rotulo: "Certidão criminal estadual" },
  { campo: "doc_certidao_federal_path", rotulo: "Certidão criminal federal" },
] as const

export type Perfil = {
  user_id: string
  nome: string | null
  telefone: string | null
  email: string | null
  perfil: string
  creci: string | null
  creci_uf: string | null
  creci_ok: boolean
  whatsapp: string | null
  uf: string | null
  cidade: string | null
  endereco: string | null
  slug: string | null
  foto_path: string | null
  doc_creci_path: string | null
  doc_residencia_path: string | null
  doc_certidao_estadual_path: string | null
  doc_certidao_federal_path: string | null
  status: "pendente" | "aprovado" | "recusado"
  motivo: string | null
  aceite_termos: string | null
  enviado_em: string | null
  bairros_atuacao?: string[] | null
  recebe_leads?: boolean | null
  plano?: string | null
  plano_ate?: string | null
}

export function slugDe(nome: string) {
  return nome
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .slice(0, 30)
}

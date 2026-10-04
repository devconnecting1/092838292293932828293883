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

/**
 * Documentos do cadastro. Para entrar basta o CRECI ativo (foto do CRECI) e a identidade.
 * Os marcados com `selo` são opcionais e servem para o Selo Verde (verificação).
 */
export const DOCS = [
  {
    campo: "doc_identidade_path",
    rotulo: "Documento de identidade com foto (RG ou CNH)",
    selo: false,
    corretor: false,
  },
  {
    campo: "doc_creci_frente_path",
    rotulo: "Carteira do CRECI (frente)",
    selo: false,
    corretor: true,
  },
  {
    campo: "doc_creci_verso_path",
    rotulo: "Carteira do CRECI (verso)",
    selo: false,
    corretor: true,
  },
  {
    campo: "doc_print_creci_path",
    rotulo: "Print do cadastro ativo no site do CRECI",
    selo: true,
    corretor: true,
  },
  {
    campo: "doc_certidao_creci_path",
    rotulo: "Certidão de regularidade do CRECI",
    selo: true,
    corretor: true,
  },
  {
    campo: "doc_residencia_path",
    rotulo: "Comprovante de residência",
    selo: true,
    corretor: false,
  },
  {
    campo: "doc_certidao_estadual_path",
    rotulo: "Certidão criminal estadual",
    selo: true,
    corretor: true,
  },
  {
    campo: "doc_certidao_federal_path",
    rotulo: "Certidão criminal federal",
    selo: true,
    corretor: true,
  },
] as const

/** Documentos que aparecem para cada tipo de cadastro. */
export function docsDoTipo(tipo: "corretor" | "investidor") {
  return DOCS.filter((d) => tipo === "corretor" || !d.corretor)
}

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
  doc_creci_frente_path?: string | null
  doc_creci_verso_path?: string | null
  doc_print_creci_path?: string | null
  doc_certidao_creci_path?: string | null
  redes?: Record<string, string> | null
  recado_1?: string | null
  recado_2?: string | null
  pix_chave?: string | null
  banco?: Record<string, string> | null
  parceria_aceite_em?: string | null
  telefone_1?: string | null
  telefone_1_whats?: boolean | null
  telefone_2?: string | null
  telefone_2_whats?: boolean | null
  cep?: string | null
  numero?: string | null
  complemento?: string | null
  bairro?: string | null
  doc_identidade_path?: string | null
  lgpd_aceite_em?: string | null
  bio?: string | null
  atua_desde?: number | null
  selo_verde?: boolean | null
  email_verificado?: boolean | null
  whatsapp_verificado?: boolean | null
  redes_verificadas?: boolean | null
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

/** Redes sociais profissionais aceitas no cadastro (mais um campo livre para rede nova). */
export const REDES = [
  ["instagram", "Instagram profissional"],
  ["facebook", "Página do Facebook"],
  ["linkedin", "LinkedIn"],
  ["youtube", "YouTube"],
  ["tiktok", "TikTok"],
  ["site", "Site"],
  ["outra", "Outra rede (link)"],
] as const

export const PARCERIA_VERSAO = "2026-10-v1"

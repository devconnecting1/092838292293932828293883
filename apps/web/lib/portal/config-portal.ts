import { createClient } from "@supabase/supabase-js"

import { getSupabaseEnv } from "@/lib/supabase/env"

/**
 * Valores que o CEO define em Gestão > Configurações (tabela config_portal).
 * Os padrões abaixo só valem enquanto o banco não tiver o valor gravado.
 */
export type ConfigPortal = {
  planos: Record<string, unknown>
  parceria_regras: {
    inatividade_meses: number
    bonus_venda_meses: number
    taxa_adesao: number | null
    taxa_administracao: number | null
  }
  parceria_leilao: {
    corretor_com_documentacao: number
    corretor_sem_documentacao: number
    indicacao: number | null
  }
  parceria_leilao_imobiliaria: { imobiliaria: number; emite_nota_fiscal: boolean }
  comissao_avulso: { total: number; plataforma: number; corretor: number }
  plano_anuncio_proprietario: { preco: number; dias: number }
  rodizio: { modo: "manual" | "automatico"; prazo_minutos: number }
  termo_indicacao: { versao: string; nao_aliciamento_meses?: number }
  calculadora: { aluguel_min_pct: number; aluguel_max_pct: number; minimo_amostras: number }
  assessoria_bens: Record<"veiculos" | "agro" | "animais" | "diversos", number | null> & {
    indicacao_pct?: number | null
  }
  crm_alertas: {
    central_minutos: number
    primeiro_contato_horas: number
    retorno_horas: number
    escalar_horas: number
    chamado_horas: number
    lembrete_tarefa_minutos: number
  }
}

export const CONFIG_PADRAO: ConfigPortal = {
  planos: {},
  parceria_regras: {
    inatividade_meses: 3,
    bonus_venda_meses: 12,
    taxa_adesao: 50,
    taxa_administracao: null,
  },
  parceria_leilao: {
    corretor_com_documentacao: 40,
    corretor_sem_documentacao: 20,
    indicacao: null,
  },
  parceria_leilao_imobiliaria: { imobiliaria: 50, emite_nota_fiscal: true },
  comissao_avulso: { total: 6, plataforma: 2, corretor: 4 },
  plano_anuncio_proprietario: { preco: 99.9, dias: 60 },
  rodizio: { modo: "manual", prazo_minutos: 30 },
  termo_indicacao: { versao: "2026-10-v1", nao_aliciamento_meses: 12 },
  calculadora: { aluguel_min_pct: 0.4, aluguel_max_pct: 0.6, minimo_amostras: 5 },
  assessoria_bens: {
    veiculos: null,
    agro: null,
    animais: null,
    diversos: null,
    indicacao_pct: null,
  },
  crm_alertas: {
    central_minutos: 30,
    primeiro_contato_horas: 2,
    retorno_horas: 48,
    escalar_horas: 24,
    chamado_horas: 4,
    lembrete_tarefa_minutos: 60,
  },
}

/** Junta o que veio do banco com os padrões, chave a chave. */
export function montarConfig(linhas: { chave: string; valor: unknown }[] | null): ConfigPortal {
  const c = structuredClone(CONFIG_PADRAO) as Record<string, unknown>
  for (const l of linhas ?? []) {
    const padrao = c[l.chave]
    if (padrao && typeof padrao === "object" && l.valor && typeof l.valor === "object")
      c[l.chave] = { ...(padrao as object), ...(l.valor as object) }
    else if (l.valor !== undefined) c[l.chave] = l.valor
  }
  return c as ConfigPortal
}

/** Leitura no servidor (páginas e rotas). Sem banco, devolve os padrões. */
export async function lerConfigPortal(): Promise<ConfigPortal> {
  const env = getSupabaseEnv()
  if (!env) return structuredClone(CONFIG_PADRAO)
  try {
    const sb = createClient(env.url, env.publishableKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    })
    const { data } = await sb.from("config_portal").select("chave, valor")
    return montarConfig((data as { chave: string; valor: unknown }[] | null) ?? null)
  } catch {
    return structuredClone(CONFIG_PADRAO)
  }
}

export const pct = (v: number | null | undefined) =>
  v == null ? "a definir" : `${String(v).replace(".", ",")}%`
export const reais = (v: number | null | undefined) =>
  v == null ? "a definir" : v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })

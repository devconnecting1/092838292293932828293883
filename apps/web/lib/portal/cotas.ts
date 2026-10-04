import "server-only"

import { createClient } from "@supabase/supabase-js"

import { getSupabaseEnv } from "@/lib/supabase/env"

import { toPortalListing, type PortalListing } from "./imoveis"
import { calcular, entradasPadrao, modalidadeDe } from "./viabilidade"

/** Cada cota vale 10% do investimento total; o imóvel só é arrematado com 10 cotas. */
export const TOTAL_COTAS = 10
export const PCT_COTA = 10

export type CotaConta = {
  lance: number
  leiloeiro: number
  itbi: number
  cartorio: number
  assessoria: number
  manutencao: number
  total: number
  valorCota: number
  /** Estimativa da calculadora de viabilidade, com venda pelo valor de avaliação. */
  lucroLiquido: number
  roi: number
}

export type CotaResumo = { reservadas: number; status: string }

function client() {
  const env = getSupabaseEnv()
  if (!env) return null
  return createClient(env.url, env.publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })
}

/**
 * Conta da cota pela calculadora de viabilidade: lance e despesas de compra,
 * mais uma reserva de 2% da avaliação para manutenção e pintura.
 */
export function contaDaCota(item: PortalListing): CotaConta {
  const e = entradasPadrao({
    avaliacao: item.valorAvaliacao,
    preco: item.preco,
    modalidade: modalidadeDe(item.modalidade, item.origem),
  })
  e.obra = Math.round((item.valorAvaliacao ?? item.preco) * 0.02)
  const { avista } = calcular(e)
  const linha = (nome: string) => avista.linhas.find((l) => l.item === nome)?.valor ?? 0
  const leiloeiro = linha("Comissão do leiloeiro")
  const itbi = linha("ITBI")
  const total = e.lance + leiloeiro + itbi + e.cartorio + e.assessoria + e.obra
  return {
    lance: e.lance,
    leiloeiro,
    itbi,
    cartorio: e.cartorio,
    assessoria: e.assessoria,
    manutencao: e.obra,
    total,
    valorCota: total / TOTAL_COTAS,
    lucroLiquido: avista.lucroLiquido,
    roi: avista.roi,
  }
}

/** Cotas já reservadas por imóvel. Sem a tabela de cotas, tudo aparece em aberto. */
export async function resumoCotas(ids: string[]): Promise<Record<string, CotaResumo>> {
  const out: Record<string, CotaResumo> = {}
  for (const id of ids) out[id] = { reservadas: 0, status: "aberto" }
  const sb = client()
  if (!sb || !ids.length) return out
  const { data, error } = await sb.rpc("cotas_resumo", { p_ids: ids })
  if (error || !Array.isArray(data)) return out
  for (const r of data as { imovel_id: string; reservadas: number; status: string }[]) {
    out[r.imovel_id] = { reservadas: Number(r.reservadas) || 0, status: r.status }
  }
  return out
}

/**
 * Imóveis sugeridos para cota: primeiro os escolhidos pela equipe; depois, os de
 * maior desconto com preço que cabe num grupo.
 */
export async function imoveisSugeridos(limite = 9): Promise<PortalListing[]> {
  const sb = client()
  if (!sb) return []
  const escolhidos: PortalListing[] = []
  const grupos = await sb
    .from("cotas_grupos")
    .select("imovel_id")
    .eq("destaque", true)
    .in("status", ["aberto", "fechado"])
    .limit(limite)
  const ids = (grupos.data ?? []).map((g: { imovel_id: string }) => g.imovel_id)
  if (ids.length) {
    const { data } = await sb.from("imoveis").select("*").in("id", ids).eq("ativo", true)
    for (const r of data ?? []) escolhidos.push(toPortalListing(r))
  }
  if (escolhidos.length >= limite) return escolhidos.slice(0, limite)
  const { data } = await sb
    .from("imoveis")
    .select("*")
    .eq("ativo", true)
    .gte("desconto", 35)
    .lte("desconto", 70)
    .gte("preco", 80000)
    .lte("preco", 600000)
    .not("avaliacao", "is", null)
    .order("desconto", { ascending: false, nullsFirst: false })
    .order("id", { ascending: true })
    .limit(limite * 2)
  const vistos = new Set(escolhidos.map((i) => i.numero))
  for (const r of data ?? []) {
    const item = toPortalListing(r)
    if (vistos.has(item.numero)) continue
    // Descarta avaliação fora da realidade (erro na lista do banco).
    if (!item.valorAvaliacao || item.valorAvaliacao > item.preco * 3.5) continue
    escolhidos.push(item)
    vistos.add(item.numero)
    if (escolhidos.length >= limite) break
  }
  return escolhidos
}

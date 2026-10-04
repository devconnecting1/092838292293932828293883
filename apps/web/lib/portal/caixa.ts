import "server-only"

import { createClient } from "@supabase/supabase-js"

import { isStateCode } from "@workspace/core/br/states"
import {
  PROPERTY_TYPE_LABELS,
  PROPERTY_TYPE_VALUES,
  type PropertyType,
} from "@workspace/core/properties/enums"
import type { Database } from "@workspace/database/types"

import { getSupabaseEnv } from "@/lib/supabase/env"

export const PORTAL_PAGE_SIZE = 24

const SORTS = ["desconto", "novidades", "preco_asc", "preco_desc"] as const
export type PortalSort = (typeof SORTS)[number]

export type PortalFilters = {
  q: string
  uf: string
  cidade: string
  tipo: PropertyType | ""
  financiamento: boolean | null
  minDesconto: number | null
  maxPreco: number | null
  sort: PortalSort
  page: number
}

export type PortalListing = {
  numero: string
  uf: string
  cidade: string
  bairro: string | null
  endereco: string
  preco: number
  valorAvaliacao: number | null
  desconto: number | null
  aceitaFinanciamento: boolean | null
  descricao: string | null
  modalidade: string | null
  link: string
  tipo: PropertyType
  areaPrivativa: number | null
  areaTotal: number | null
  areaTerreno: number | null
  quartos: number | null
  vagas: number | null
  listaGeradaEm: string | null
}

export type PortalFacets = {
  total: number
  atualizadoEm: string | null
  ufs: { uf: string; count: number }[]
  cidades: { cidade: string; count: number }[]
}

type Params = Record<string, string | string[] | undefined>

function first(value: string | string[] | undefined) {
  return (Array.isArray(value) ? value[0] : value)?.trim() ?? ""
}

function int(value: string, max: number) {
  const digits = value.replace(/\D/g, "")
  if (!digits) return null
  const n = Number(digits)
  return Number.isSafeInteger(n) && n <= max ? n : null
}

export function parsePortalFilters(params: Params): PortalFilters {
  const uf = first(params.uf).toUpperCase()
  const fin = first(params.financiamento)
  const tipo = first(params.tipo)
  const sort = first(params.ordem)
  return {
    q: first(params.q).slice(0, 100),
    uf: isStateCode(uf) ? uf : "",
    cidade: first(params.cidade).slice(0, 120),
    tipo: (PROPERTY_TYPE_VALUES as readonly string[]).includes(tipo) ? (tipo as PropertyType) : "",
    financiamento: fin === "sim" ? true : fin === "nao" ? false : null,
    minDesconto: int(first(params.desconto), 99),
    maxPreco: int(first(params.ate), 999_999_999),
    sort: (SORTS as readonly string[]).includes(sort) ? (sort as PortalSort) : "desconto",
    page: Math.max(1, int(first(params.pagina), 800) ?? 1),
  }
}

export function filtersToParams(f: PortalFilters) {
  const p = new URLSearchParams()
  if (f.q) p.set("q", f.q)
  if (f.uf) p.set("uf", f.uf)
  if (f.cidade) p.set("cidade", f.cidade)
  if (f.tipo) p.set("tipo", f.tipo)
  if (f.financiamento != null) p.set("financiamento", f.financiamento ? "sim" : "nao")
  if (f.minDesconto != null) p.set("desconto", String(f.minDesconto))
  if (f.maxPreco != null) p.set("ate", String(f.maxPreco))
  if (f.sort !== "desconto") p.set("ordem", f.sort)
  return p
}

function client() {
  const env = getSupabaseEnv()
  if (!env) return null
  return createClient<Database>(env.url, env.publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })
}

function num(v: unknown) {
  return v === null || v === undefined ? null : Number(v)
}

type Row = {
  numero: string
  uf: string
  cidade: string
  bairro: string | null
  endereco: string
  preco: number | string
  valor_avaliacao: number | string | null
  desconto: number | string | null
  aceita_financiamento: boolean | null
  descricao: string | null
  modalidade: string | null
  link: string
  tipo: PropertyType
  area_total: number | string | null
  area_privativa: number | string | null
  area_terreno: number | string | null
  quartos: number | null
  vagas: number | null
  lista_gerada_em: string | null
  total_count?: number | string
}

function toListing(r: Row): PortalListing {
  return {
    numero: r.numero,
    uf: r.uf,
    cidade: r.cidade,
    bairro: r.bairro,
    endereco: r.endereco,
    preco: Number(r.preco),
    valorAvaliacao: num(r.valor_avaliacao),
    desconto: num(r.desconto),
    aceitaFinanciamento: r.aceita_financiamento,
    descricao: r.descricao,
    modalidade: r.modalidade,
    link: r.link,
    tipo: r.tipo,
    areaTotal: num(r.area_total),
    areaPrivativa: num(r.area_privativa),
    areaTerreno: num(r.area_terreno),
    quartos: r.quartos,
    vagas: r.vagas,
    listaGeradaEm: r.lista_gerada_em,
  }
}

export async function searchPortalListings(f: PortalFilters, limit = PORTAL_PAGE_SIZE) {
  const supabase = client()
  if (!supabase) return { items: [] as PortalListing[], total: 0, pageCount: 0, configured: false }

  const { data, error } = await supabase.rpc("public_search_caixa_listings", {
    p_term: f.q || undefined,
    p_uf: f.uf || undefined,
    p_cidade: f.cidade || undefined,
    p_tipo: f.tipo || undefined,
    p_financiamento: f.financiamento ?? undefined,
    p_min_desconto: f.minDesconto ?? undefined,
    p_max_price: f.maxPreco ?? undefined,
    p_sort: f.sort,
    p_limit: limit,
    p_offset: (f.page - 1) * limit,
  })

  if (error || !data) {
    return { items: [] as PortalListing[], total: 0, pageCount: 0, configured: true }
  }

  const rows = data as unknown as Row[]
  const total = rows.length ? Number(rows[0]!.total_count ?? rows.length) : 0
  return {
    items: rows.map(toListing),
    total,
    pageCount: Math.ceil(total / limit),
    configured: true,
  }
}

export async function getPortalListing(numero: string) {
  if (!/^[0-9]{1,13}$/.test(numero)) return null
  const supabase = client()
  if (!supabase) return null
  const { data, error } = await supabase.rpc("public_get_caixa_listing", { p_numero: numero })
  if (error || !data) return null
  const rows = data as unknown as Row[]
  return rows[0] ? toListing(rows[0]) : null
}

export async function getPortalFacets(uf?: string): Promise<PortalFacets> {
  const empty: PortalFacets = { total: 0, atualizadoEm: null, ufs: [], cidades: [] }
  const supabase = client()
  if (!supabase) return empty
  const { data, error } = await supabase.rpc("public_caixa_catalog_facets", {
    p_uf: uf || undefined,
  })
  if (error || !data || typeof data !== "object") return empty
  const d = data as Record<string, unknown>
  return {
    total: Number(d.total ?? 0),
    atualizadoEm: (d.atualizado_em as string | null) ?? null,
    ufs: (d.ufs as PortalFacets["ufs"]) ?? [],
    cidades: (d.cidades as PortalFacets["cidades"]) ?? [],
  }
}

export function tipoLabel(tipo: string) {
  return PROPERTY_TYPE_LABELS[tipo as PropertyType] ?? "Imóvel"
}

export const TIPOS_FILTRO: { value: PropertyType; label: string }[] = (
  [
    "apartment",
    "house",
    "condo_house",
    "land",
    "commercial_room",
    "store",
    "warehouse",
    "building",
    "farm",
  ] as PropertyType[]
).map((value) => ({ value, label: PROPERTY_TYPE_LABELS[value] }))

export const brl = (v: number | null) =>
  v == null
    ? "Sob consulta"
    : v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 })

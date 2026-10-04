import "server-only"

import { createClient } from "@supabase/supabase-js"

import { isStateCode } from "@workspace/core/br/states"

import { getSupabaseEnv } from "@/lib/supabase/env"

/**
 * Leitura do catálogo de imóveis da Caixa para o portal público.
 *
 * Fonte: tabela `public.imoveis` do projeto Supabase do portal (importação da
 * lista oficial da Caixa por estado). A tabela tem RLS com leitura pública
 * (política `imoveis_publico`), então o portal lê só com a chave pública, sem
 * sessão e sem chave de serviço.
 */

export const PORTAL_PAGE_SIZE = 24

const SORTS = ["desconto", "novidades", "preco_asc", "preco_desc"] as const
export type PortalSort = (typeof SORTS)[number]

export const TIPOS_FILTRO = [
  "Apartamento",
  "Casa",
  "Sobrado",
  "Terreno",
  "Sala",
  "Loja",
  "Comercial",
  "Galpão",
  "Prédio",
  "Gleba",
  "Imóvel rural",
].map((t) => ({ value: t, label: t }))

export type PortalFilters = {
  q: string
  uf: string
  cidade: string
  tipo: string
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
  tipo: string
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
    q: first(params.q).slice(0, 80),
    uf: isStateCode(uf) ? uf : "",
    cidade: first(params.cidade).slice(0, 120),
    tipo: TIPOS_FILTRO.some((t) => t.value === tipo) ? tipo : "",
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
  return createClient(env.url, env.publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })
}

const COLUMNS =
  "id,uf,cidade,bairro,endereco,preco,avaliacao,desconto,financiamento,descricao,tipo,area_total,area_privativa,area_terreno,quartos,vagas,modalidade,link,atualizado"

type Row = {
  id: string
  uf: string
  cidade: string
  bairro: string | null
  endereco: string | null
  preco: number | string
  avaliacao: number | string | null
  desconto: number | string | null
  financiamento: boolean | null
  descricao: string | null
  tipo: string | null
  area_total: number | string | null
  area_privativa: number | string | null
  area_terreno: number | string | null
  quartos: number | null
  vagas: number | null
  modalidade: string | null
  link: string | null
  atualizado: string | null
}

function num(v: unknown) {
  if (v === null || v === undefined || v === "") return null
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? n : null
}

function toListing(r: Row): PortalListing {
  return {
    numero: r.id,
    uf: r.uf,
    cidade: r.cidade,
    bairro: r.bairro,
    endereco: r.endereco ?? "",
    preco: Number(r.preco),
    valorAvaliacao: num(r.avaliacao),
    desconto: num(r.desconto),
    aceitaFinanciamento: r.financiamento,
    descricao: r.descricao,
    modalidade: r.modalidade,
    link:
      r.link && r.link.startsWith("https://venda-imoveis.caixa.gov.br/")
        ? r.link
        : `https://venda-imoveis.caixa.gov.br/sistema/detalhe-imovel.asp?hdnimovel=${r.id}`,
    tipo: r.tipo ?? "Imóvel",
    areaTotal: num(r.area_total),
    areaPrivativa: num(r.area_privativa),
    areaTerreno: num(r.area_terreno),
    quartos: r.quartos,
    vagas: r.vagas,
    listaGeradaEm: r.atualizado,
  }
}

/** Remove o que tem significado na sintaxe de filtros do PostgREST. */
function safeTerm(value: string) {
  return value
    .replace(/[%,().*:"'\\]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

export async function searchPortalListings(f: PortalFilters, limit = PORTAL_PAGE_SIZE) {
  const empty = { items: [] as PortalListing[], total: 0, pageCount: 0 }
  const supabase = client()
  if (!supabase) return empty

  let query = supabase.from("imoveis").select(COLUMNS, { count: "exact" }).eq("ativo", true)

  if (f.uf) query = query.eq("uf", f.uf)
  if (f.cidade) query = query.ilike("cidade", safeTerm(f.cidade))
  if (f.tipo) query = query.eq("tipo", f.tipo)
  if (f.financiamento != null) query = query.eq("financiamento", f.financiamento)
  if (f.minDesconto != null) query = query.gte("desconto", f.minDesconto)
  if (f.maxPreco != null) query = query.lte("preco", f.maxPreco)

  const term = safeTerm(f.q)
  if (term) {
    if (/^\d{6,13}$/.test(term)) {
      query = query.eq("id", term)
    } else {
      const like = `%${term}%`
      query = query.or(`cidade.ilike.${like},bairro.ilike.${like},endereco.ilike.${like}`)
    }
  }

  if (f.sort === "preco_asc") query = query.order("preco", { ascending: true })
  else if (f.sort === "preco_desc") query = query.order("preco", { ascending: false })
  else if (f.sort === "novidades") query = query.order("criado", { ascending: false })
  else query = query.order("desconto", { ascending: false, nullsFirst: false })
  query = query.order("id", { ascending: true })

  const from = (f.page - 1) * limit
  const { data, error, count } = await query.range(from, from + limit - 1)
  if (error || !data) return empty

  const total = count ?? data.length
  return {
    items: (data as unknown as Row[]).map(toListing),
    total,
    pageCount: Math.ceil(total / limit),
  }
}

export async function getPortalListing(numero: string) {
  if (!/^[0-9]{1,13}$/.test(numero)) return null
  const supabase = client()
  if (!supabase) return null
  const { data, error } = await supabase
    .from("imoveis")
    .select(COLUMNS)
    .eq("id", numero)
    .eq("ativo", true)
    .maybeSingle()
  if (error || !data) return null
  return toListing(data as unknown as Row)
}

export async function getPortalFacets(uf?: string): Promise<PortalFacets> {
  const empty: PortalFacets = { total: 0, atualizadoEm: null, ufs: [], cidades: [] }
  const supabase = client()
  if (!supabase) return empty

  const [resumo, cidades] = await Promise.all([
    supabase.rpc("resumo_vitrine"),
    uf ? supabase.rpc("cidades", { p_uf: uf }) : Promise.resolve({ data: [], error: null }),
  ])

  const r = (resumo.data ?? {}) as {
    total?: number
    atualizado?: string | null
    ufs?: { uf: string; n: number }[] | null
  }
  const c = (cidades.data ?? []) as { cidade: string; n: number }[]

  return {
    total: Number(r.total ?? 0),
    atualizadoEm: r.atualizado ?? null,
    ufs: (r.ufs ?? []).map((x) => ({ uf: x.uf, count: Number(x.n) })),
    cidades: c
      .map((x) => ({ cidade: x.cidade, count: Number(x.n) }))
      .sort((a, b) => a.cidade.localeCompare(b.cidade, "pt-BR")),
  }
}

export function tipoLabel(tipo: string) {
  return tipo || "Imóvel"
}

export const brl = (v: number | null) =>
  v == null
    ? "Sob consulta"
    : v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 })

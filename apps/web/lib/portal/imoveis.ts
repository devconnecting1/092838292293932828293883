import "server-only"

import { createClient } from "@supabase/supabase-js"

import { isStateCode } from "@workspace/core/br/states"

import { getSupabaseEnv } from "@/lib/supabase/env"

/**
 * Catálogo de imóveis de leilão do portal (todas as origens).
 *
 * Fonte: tabela `public.imoveis` do projeto Supabase do portal. A Caixa entra
 * pela lista oficial; os demais bancos, leilões judiciais e extrajudiciais
 * entram pelos parceiros (função `importar-feed`). A tabela tem leitura pública
 * por RLS, então o portal lê só com a chave pública, sem sessão.
 */

export const PORTAL_PAGE_SIZE = 24

const SORTS = ["desconto", "novidades", "preco_asc", "preco_desc", "encerra"] as const
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

/** Nomes das origens; a lista oficial fica na tabela `origens`. */
export const ORIGEM_NOME: Record<string, string> = {
  caixa: "Caixa",
  "banco-do-brasil": "Banco do Brasil",
  itau: "Itaú",
  bradesco: "Bradesco",
  santander: "Santander",
  safra: "Safra",
  inter: "Banco Inter",
  pan: "Banco Pan",
  bv: "Banco BV",
  brb: "BRB",
  sicoob: "Sicoob",
  "porto-bank": "Porto Bank",
  judicial: "Leilão judicial",
  extrajudicial: "Leilão extrajudicial",
  outros: "Outras origens",
}

export function origemNome(slug: string) {
  return ORIGEM_NOME[slug] ?? "Outras origens"
}

export type PortalFilters = {
  q: string
  uf: string
  cidade: string
  tipo: string
  origem: string
  leiloeiro: string
  financiamento: boolean | null
  minDesconto: number | null
  maxPreco: number | null
  sort: PortalSort
  page: number
}

export type PortalListing = {
  /** Identificador no portal (na Caixa, o número do imóvel). */
  numero: string
  origem: string
  origemNome: string
  fonte: string
  uf: string
  cidade: string
  bairro: string | null
  endereco: string
  cep: string | null
  preco: number
  valorAvaliacao: number | null
  desconto: number | null
  aceitaFinanciamento: boolean | null
  descricao: string | null
  modalidade: string | null
  link: string | null
  tipo: string
  areaPrivativa: number | null
  areaTotal: number | null
  areaTerreno: number | null
  quartos: number | null
  vagas: number | null
  codigoBanco: string | null
  codigoLeilao: string | null
  codigoFonte: string | null
  leiloeiro: string | null
  leiloeiroRegistro: string | null
  intermediador: string | null
  matricula: string | null
  cartorio: string | null
  processo: string | null
  vara: string | null
  dataLeilao1: string | null
  dataLeilao2: string | null
  lanceLeilao2: number | null
  dataEncerramento: string | null
  editalUrl: string | null
  fotos: string[]
  latitude: number | null
  longitude: number | null
  atualizadoEm: string | null
}

export type PortalFacets = {
  total: number
  atualizadoEm: string | null
  ufs: { uf: string; count: number }[]
  cidades: { cidade: string; count: number }[]
  origens: { slug: string; nome: string; count: number }[]
  leiloeiros: { nome: string; count: number }[]
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
  const origem = first(params.origem)
  const sort = first(params.ordem)
  return {
    q: first(params.q).slice(0, 80),
    uf: isStateCode(uf) ? uf : "",
    cidade: first(params.cidade).slice(0, 120),
    tipo: TIPOS_FILTRO.some((t) => t.value === tipo) ? tipo : "",
    origem: origem in ORIGEM_NOME ? origem : "",
    leiloeiro: first(params.leiloeiro).slice(0, 160),
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
  if (f.origem) p.set("origem", f.origem)
  if (f.leiloeiro) p.set("leiloeiro", f.leiloeiro)
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

type Row = Record<string, unknown>

function num(v: unknown) {
  if (v === null || v === undefined || v === "") return null
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? n : null
}

function str(v: unknown) {
  return typeof v === "string" && v.trim() ? v.trim() : null
}

function httpsOnly(v: unknown) {
  const s = str(v)
  return s && s.startsWith("https://") ? s : null
}

export function toPortalListing(r: Row): PortalListing {
  const id = String(r.id)
  const origem = str(r.origem) ?? "caixa"
  const caixaLink =
    origem === "caixa" && /^\d+$/.test(id)
      ? `https://venda-imoveis.caixa.gov.br/sistema/detalhe-imovel.asp?hdnimovel=${id}`
      : null
  const link = httpsOnly(r.link) ?? caixaLink
  return {
    numero: id,
    origem,
    origemNome: origemNome(origem),
    fonte: str(r.fonte) ?? "caixa_lista",
    uf: String(r.uf ?? ""),
    cidade: String(r.cidade ?? ""),
    bairro: str(r.bairro),
    endereco: str(r.endereco) ?? "",
    cep: str(r.cep),
    preco: Number(r.preco ?? 0),
    valorAvaliacao: num(r.avaliacao),
    desconto: num(r.desconto),
    aceitaFinanciamento: typeof r.financiamento === "boolean" ? r.financiamento : null,
    descricao: str(r.descricao),
    modalidade: str(r.modalidade),
    link,
    tipo: str(r.tipo) ?? "Imóvel",
    areaTotal: num(r.area_total),
    areaPrivativa: num(r.area_privativa),
    areaTerreno: num(r.area_terreno),
    quartos: typeof r.quartos === "number" ? r.quartos : null,
    vagas: typeof r.vagas === "number" ? r.vagas : null,
    codigoBanco: str(r.codigo_banco) ?? (origem === "caixa" ? id : null),
    codigoLeilao: str(r.codigo_leilao),
    codigoFonte: str(r.codigo_fonte),
    leiloeiro: str(r.leiloeiro),
    leiloeiroRegistro: str(r.leiloeiro_registro),
    intermediador: str(r.intermediador),
    matricula: str(r.matricula),
    cartorio: str(r.cartorio),
    processo: str(r.processo),
    vara: str(r.vara),
    dataLeilao1: str(r.data_leilao_1),
    dataLeilao2: str(r.data_leilao_2),
    lanceLeilao2: num(r.lance_leilao_2),
    dataEncerramento: str(r.data_encerramento),
    editalUrl: httpsOnly(r.edital_url) ?? caixaLink,
    fotos: Array.isArray(r.fotos)
      ? r.fotos.filter((f): f is string => typeof f === "string" && f.startsWith("https://"))
      : [],
    latitude: num(r.latitude),
    longitude: num(r.longitude),
    atualizadoEm: str(r.atualizado),
  }
}

/** Foto pela referência da Caixa (só imóveis da Caixa com número oficial). */
export function usaFotoCaixa(item: PortalListing) {
  return item.origem === "caixa" && /^\d{6,13}$/.test(item.numero) && item.fotos.length === 0
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

  let query = supabase.from("imoveis").select("*", { count: "exact" }).eq("ativo", true)

  if (f.uf) query = query.eq("uf", f.uf)
  if (f.cidade) query = query.ilike("cidade", safeTerm(f.cidade))
  if (f.tipo) query = query.eq("tipo", f.tipo)
  if (f.origem) query = query.eq("origem", f.origem)
  if (f.leiloeiro) query = query.eq("leiloeiro", f.leiloeiro)
  if (f.financiamento != null) query = query.eq("financiamento", f.financiamento)
  if (f.minDesconto != null) query = query.gte("desconto", f.minDesconto)
  if (f.maxPreco != null) query = query.lte("preco", f.maxPreco)

  const term = safeTerm(f.q)
  if (term) {
    if (/^\d{6,13}$/.test(term)) {
      query = query.or(`id.eq.${term},codigo_banco.eq.${term},codigo_fonte.eq.${term}`)
    } else {
      const like = `%${term}%`
      query = query.or(`cidade.ilike.${like},bairro.ilike.${like},endereco.ilike.${like}`)
    }
  }

  if (f.sort === "preco_asc") query = query.order("preco", { ascending: true })
  else if (f.sort === "preco_desc") query = query.order("preco", { ascending: false })
  else if (f.sort === "novidades") query = query.order("criado", { ascending: false })
  else if (f.sort === "encerra")
    query = query.order("data_encerramento", { ascending: true, nullsFirst: false })
  else query = query.order("desconto", { ascending: false, nullsFirst: false })
  query = query.order("id", { ascending: true })

  const from = (f.page - 1) * limit
  const { data, error, count } = await query.range(from, from + limit - 1)
  if (error || !data) return empty

  const total = count ?? data.length
  return {
    items: (data as Row[]).map(toPortalListing),
    total,
    pageCount: Math.ceil(total / limit),
  }
}

export async function getPortalListing(numero: string) {
  if (!/^[a-z0-9-]{1,80}$/.test(numero)) return null
  const supabase = client()
  if (!supabase) return null
  const { data, error } = await supabase
    .from("imoveis")
    .select("*")
    .eq("id", numero)
    .eq("ativo", true)
    .maybeSingle()
  if (error || !data) return null
  return toPortalListing(data as Row)
}

export async function getPortalFacets(uf?: string): Promise<PortalFacets> {
  const empty: PortalFacets = {
    total: 0,
    atualizadoEm: null,
    ufs: [],
    cidades: [],
    origens: [],
    leiloeiros: [],
  }
  const supabase = client()
  if (!supabase) return empty

  const noData = Promise.resolve({ data: [] as unknown[], error: null })
  const [resumo, cidades, origens, leiloeiros] = await Promise.all([
    supabase.rpc("resumo_vitrine"),
    uf ? supabase.rpc("cidades", { p_uf: uf }) : noData,
    supabase.rpc("origens_resumo", { p_uf: uf ?? null }),
    supabase.rpc("leiloeiros_resumo", { p_uf: uf ?? null }),
  ])

  const r = (resumo.data ?? {}) as {
    total?: number
    atualizado?: string | null
    ufs?: { uf: string; n: number }[] | null
  }
  const c = (cidades.data ?? []) as { cidade: string; n: number }[]
  const o = (origens.error ? [] : (origens.data ?? [])) as {
    slug: string
    nome: string
    n: number
  }[]
  const l = (leiloeiros.error ? [] : (leiloeiros.data ?? [])) as { leiloeiro: string; n: number }[]

  return {
    total: Number(r.total ?? 0),
    atualizadoEm: r.atualizado ?? null,
    ufs: (r.ufs ?? []).map((x) => ({ uf: x.uf, count: Number(x.n) })),
    cidades: c
      .map((x) => ({ cidade: x.cidade, count: Number(x.n) }))
      .sort((a, b) => a.cidade.localeCompare(b.cidade, "pt-BR")),
    origens: o.map((x) => ({ slug: x.slug, nome: x.nome, count: Number(x.n) })),
    leiloeiros: l.map((x) => ({ nome: x.leiloeiro, count: Number(x.n) })),
  }
}

export function tipoLabel(tipo: string) {
  return tipo || "Imóvel"
}

export const brl = (v: number | null) =>
  v == null
    ? "Sob consulta"
    : v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 })

export function dataHora(iso: string | null) {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  return d.toLocaleString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
}

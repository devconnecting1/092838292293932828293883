// Constantes do módulo "Imóveis da Caixa". Sem `server-only`: os filtros do
// navegador e as páginas do servidor usam os mesmos nomes de parâmetro.

import type { PropertyType } from "@workspace/core/properties/enums"

/** Rota do módulo. Fora de `/imoveis` para o menu não marcar os dois itens. */
export const CAIXA_BASE_PATH = "/imoveis-caixa"

/** Cards por página. O RPC aceita até 60. */
export const CAIXA_PAGE_SIZE = 10

/** Nomes dos searchParams, em pt-BR como no resto do CRM. */
export const CAIXA_LIST_PARAMS = {
  q: "q",
  uf: "uf",
  city: "cidade",
  neighborhood: "bairro",
  type: "tipo",
  saleMode: "modalidade",
  minPrice: "precoMin",
  maxPrice: "precoMax",
  financing: "financiamento",
  favorites: "favoritos",
  sort: "ordenar",
  page: "pagina",
} as const

export const CAIXA_SORT_VALUES = ["novidades", "preco_asc", "preco_desc", "desconto"] as const

export type CaixaSort = (typeof CAIXA_SORT_VALUES)[number]

export const CAIXA_SORT_LABELS: Record<CaixaSort, string> = {
  novidades: "Novidades",
  preco_asc: "Menor preço",
  preco_desc: "Maior preço",
  desconto: "Maior desconto",
}

/** Tipos que de fato aparecem no arquivo da Caixa (os outros só poluiriam o filtro). */
export const CAIXA_PROPERTY_TYPES: readonly PropertyType[] = [
  "apartment",
  "house",
  "land",
  "commercial_room",
  "store",
  "warehouse",
  "building",
  "farm",
  "other",
]

/** O que o arquivo nacional não traz e por isso o CRM não mostra. */
export const CAIXA_MISSING_FIELDS_NOTICE =
  "Matrícula, situação de ocupação e uso de FGTS não vêm na lista pública: consulte na página do imóvel no site da Caixa."

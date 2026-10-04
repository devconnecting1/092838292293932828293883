/**
 * Ponte entre o leitor do CSV e a RPC `public.ingest_caixa_listings`.
 *
 * As chaves do objeto enviado precisam bater **exatamente** com as colunas que
 * o `jsonb_to_record` da RPC declara: chave com nome errado não dá erro, vira
 * `null` no banco e a linha é recusada em silêncio. Por isso a lista está
 * escrita aqui e travada por teste.
 */

import type { PropertyType } from "../properties/enums"
import type { CaixaListingRow } from "./csv"

/** Colunas lidas pelo `jsonb_to_record` de `public.ingest_caixa_listings`. */
export const CAIXA_RPC_ROW_KEYS = [
  "numero",
  "uf",
  "cidade",
  "bairro",
  "endereco",
  "preco",
  "valor_avaliacao",
  "desconto",
  "aceita_financiamento",
  "descricao",
  "modalidade",
  "link",
  "tipo",
  "area_total",
  "area_privativa",
  "area_terreno",
  "quartos",
  "vagas",
] as const

export type CaixaRpcRow = {
  numero: string
  uf: string
  cidade: string
  bairro: string | null
  endereco: string
  preco: number
  valor_avaliacao: number | null
  desconto: number | null
  aceita_financiamento: boolean | null
  descricao: string | null
  modalidade: string | null
  link: string
  tipo: PropertyType
  area_total: number | null
  area_privativa: number | null
  area_terreno: number | null
  quartos: number | null
  vagas: number | null
}

/** Falha na compilação se a lista de chaves e o tipo saírem de sincronia. */
type KeysMatch = (typeof CAIXA_RPC_ROW_KEYS)[number] extends keyof CaixaRpcRow
  ? keyof CaixaRpcRow extends (typeof CAIXA_RPC_ROW_KEYS)[number]
    ? true
    : never
  : never

const _keysMatch: KeysMatch = true
void _keysMatch

export function caixaListingToRpcRow(row: CaixaListingRow): CaixaRpcRow {
  return {
    numero: row.numero,
    uf: row.uf,
    cidade: row.cidade,
    bairro: row.bairro,
    endereco: row.endereco,
    preco: row.preco,
    valor_avaliacao: row.valorAvaliacao,
    desconto: row.desconto,
    aceita_financiamento: row.aceitaFinanciamento,
    descricao: row.descricao,
    modalidade: row.modalidade,
    link: row.link,
    tipo: row.tipo,
    area_total: row.areaTotal,
    area_privativa: row.areaPrivativa,
    area_terreno: row.areaTerreno,
    quartos: row.quartos,
    vagas: row.vagas,
  }
}

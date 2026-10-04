import { describe, expect, it } from "vitest"

import { parseCaixaCsv, type CaixaListingRow } from "./csv"
import { CAIXA_RPC_ROW_KEYS, caixaListingToRpcRow } from "./rpc-row"

const LISTING: CaixaListingRow = {
  numero: "8787709515913",
  uf: "ES",
  cidade: "Cariacica",
  bairro: "Tucum",
  endereco: "RUA SAO PAULO APOSTOLO, N. 23",
  preco: 134_287.99,
  valorAvaliacao: 222_179,
  desconto: 39.56,
  aceitaFinanciamento: true,
  descricao: "Apartamento, 74.12 de área total",
  modalidade: "Licitação Aberta",
  link: "https://venda-imoveis.caixa.gov.br/sistema/detalhe-imovel.asp?hdnimovel=8787709515913",
  tipo: "apartment",
  areaTotal: 74.12,
  areaPrivativa: 56.82,
  areaTerreno: null,
  quartos: 2,
  vagas: 1,
}

describe("caixaListingToRpcRow", () => {
  /**
   * Trava o contrato com a RPC: chave com nome errado não daria erro, viraria
   * `null` no `jsonb_to_record` e a linha seria recusada em silêncio. Se este
   * teste quebrar, a migração correspondente também precisa mudar.
   */
  it("manda exatamente as colunas que a RPC lê", () => {
    expect(Object.keys(caixaListingToRpcRow(LISTING)).sort()).toEqual(
      [...CAIXA_RPC_ROW_KEYS].sort()
    )
  })

  it("mantém os valores e os nulos do registro lido", () => {
    expect(caixaListingToRpcRow(LISTING)).toEqual({
      numero: "8787709515913",
      uf: "ES",
      cidade: "Cariacica",
      bairro: "Tucum",
      endereco: "RUA SAO PAULO APOSTOLO, N. 23",
      preco: 134_287.99,
      valor_avaliacao: 222_179,
      desconto: 39.56,
      aceita_financiamento: true,
      descricao: "Apartamento, 74.12 de área total",
      modalidade: "Licitação Aberta",
      link: "https://venda-imoveis.caixa.gov.br/sistema/detalhe-imovel.asp?hdnimovel=8787709515913",
      tipo: "apartment",
      area_total: 74.12,
      area_privativa: 56.82,
      area_terreno: null,
      quartos: 2,
      vagas: 1,
    })
  })

  it("cobre todos os campos que o leitor do CSV produz", () => {
    const csv = [
      "",
      " Lista de Imóveis da Caixa;;Data de geração:;15/09/2026;;;;;;;",
      " N° do imóvel;UF;Cidade;Bairro;Endereço;Preço;Valor de avaliação;Desconto;Financiamento;Descrição;Modalidade de venda;Link de acesso",
      "",
      " 1555518212585 ;AC ;BUJARI ;CENTRO ;RUA PROJETADA 2 ;170.000,00;170.000,00;0.00;Não;Casa, 360.00 de área do terreno.;Leilão SFI - Edital Único;https://venda-imoveis.caixa.gov.br/sistema/detalhe-imovel.asp?hdnimovel=1555518212585",
      "",
    ].join("\n")

    const result = parseCaixaCsv(csv)
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const row = result.rows[0]
    expect(row).toBeDefined()
    if (!row) return

    // Cada campo do registro lido tem um destino na RPC (nenhum fica pelo caminho).
    expect(Object.keys(row)).toHaveLength(CAIXA_RPC_ROW_KEYS.length)
    expect(Object.keys(caixaListingToRpcRow(row))).toHaveLength(Object.keys(row).length)
  })
})

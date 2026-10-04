import { describe, expect, it } from "vitest"

import { CAIXA_CSV_COLUMNS, parseCaixaCsv } from "./csv"

/** Cabeçalho real do arquivo (linha 3), incluindo o espaço antes de "N°". */
const HEADER = ` ${CAIXA_CSV_COLUMNS.join(";")}`

const TITLE = " Lista de Imóveis da Caixa;;Data de geração:;15/09/2026;;;;;;;"

/** Registros reais do arquivo de 15/09/2026, com os espaços que a Caixa manda. */
const ROW_AC =
  " 1555518212585 ;AC ;BUJARI ;CENTRO ;RUA PROJETADA 2, N. SN, LT 19 QD B ;170.000,00;170.000,00;0.00;Não;Casa, 0.00 de área total, 75.17 de área privativa, 360.00 de área do terreno.;Leilão SFI - Edital Único;https://venda-imoveis.caixa.gov.br/sistema/detalhe-imovel.asp?hdnimovel=1555518212585"

const ROW_ES =
  " 8787709515913 ;ES ;CARIACICA ;TUCUM ;RUA SAO PAULO APOSTOLO, N. 23, Apto 402, BLOCO 14 VG 147 ;134.287,99;222.179,00;39.56;Sim;Apartamento, 74.12 de área total, 56.82 de área privativa, 0.00 de área do terreno, 2 qto(s), varanda, a.serv, WC, 1 sala(s), cozinha, 1 vaga(s) de garagem.;Licitação Aberta;https://venda-imoveis.caixa.gov.br/sistema/detalhe-imovel.asp?hdnimovel=8787709515913"

function buildCsv(rows: string[], header = HEADER) {
  return ["", TITLE, header, "", ...rows, ""].join("\n")
}

describe("parseCaixaCsv", () => {
  it("lê a data de geração e os registros do arquivo", () => {
    const result = parseCaixaCsv(buildCsv([ROW_AC, ROW_ES]))

    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.generatedOn).toBe("2026-09-15")
    expect(result.rejected).toEqual([])
    expect(result.rows).toHaveLength(2)

    expect(result.rows[0]).toEqual({
      numero: "1555518212585",
      uf: "AC",
      cidade: "Bujari",
      bairro: "Centro",
      endereco: "RUA PROJETADA 2, N. SN, LT 19 QD B",
      preco: 170_000,
      valorAvaliacao: 170_000,
      desconto: 0,
      aceitaFinanciamento: false,
      descricao: "Casa, 0.00 de área total, 75.17 de área privativa, 360.00 de área do terreno.",
      modalidade: "Leilão SFI - Edital Único",
      link: "https://venda-imoveis.caixa.gov.br/sistema/detalhe-imovel.asp?hdnimovel=1555518212585",
      tipo: "house",
      areaTotal: null,
      areaPrivativa: 75.17,
      areaTerreno: 360,
      quartos: null,
      vagas: null,
    })

    expect(result.rows[1]).toMatchObject({
      numero: "8787709515913",
      uf: "ES",
      cidade: "Cariacica",
      // O desconto é o que a Caixa publicou, nunca uma conta nossa.
      desconto: 39.56,
      preco: 134_287.99,
      valorAvaliacao: 222_179,
      aceitaFinanciamento: true,
      tipo: "apartment",
      quartos: 2,
      vagas: 1,
    })
  })

  it("aborta a carga inteira quando o cabeçalho muda", () => {
    const result = parseCaixaCsv(buildCsv([ROW_AC], HEADER.replace(";Desconto", ";Abatimento")))

    expect(result).toMatchObject({ ok: false, reason: "cabecalho" })
    if (result.ok) return
    expect(result.foundHeader).toContain("Abatimento")
  })

  it("aborta quando não sobra nenhum registro válido", () => {
    expect(parseCaixaCsv(buildCsv([]))).toMatchObject({ ok: false, reason: "vazio" })
  })

  it("recusa a linha inválida sem derrubar as outras", () => {
    const semCampos = " 1;AC ;BUJARI ;CENTRO ;RUA A ;1,00"
    const semNumero = ROW_AC.replace(" 1555518212585 ", " ABC ")
    const ufInvalida = ROW_AC.replace(";AC ;", ";XX ;").replace("1555518212585", "1555518212586")
    const precoInvalido = ROW_ES.replace(";134.287,99;", ";Consulte;").replace(
      "8787709515913 ;ES",
      "8787709515914 ;ES"
    )

    const result = parseCaixaCsv(
      buildCsv([semCampos, semNumero, ufInvalida, precoInvalido, ROW_AC])
    )

    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.rows).toHaveLength(1)
    expect(result.rows[0]?.numero).toBe("1555518212585")
    expect(result.rejected.map((item) => item.reason)).toEqual(["campos", "numero", "uf", "preco"])
  })

  it("recusa link que não seja do site da Caixa", () => {
    const forjado = ROW_AC.replace(
      "https://venda-imoveis.caixa.gov.br/sistema/detalhe-imovel.asp?hdnimovel=1555518212585",
      "https://venda-imoveis.caixa.gov.br.invalid/phishing"
    )

    const result = parseCaixaCsv(buildCsv([forjado, ROW_ES]))

    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.rows).toHaveLength(1)
    expect(result.rejected).toEqual([{ line: 5, reason: "link" }])
  })

  it("mantém a primeira ocorrência e recusa o número repetido", () => {
    const result = parseCaixaCsv(buildCsv([ROW_AC, ROW_AC.replace(";CENTRO ;", ";OUTRO ;")]))

    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.rows).toHaveLength(1)
    expect(result.rows[0]?.bairro).toBe("Centro")
    expect(result.rejected).toEqual([{ line: 6, reason: "numero_repetido" }])
  })

  it("aceita CRLF e linhas em branco no meio", () => {
    const result = parseCaixaCsv(["", TITLE, HEADER, "", ROW_AC, "", ROW_ES, ""].join("\r\n"))

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.rows).toHaveLength(2)
    expect(result.rejected).toEqual([])
  })

  it("aponta a linha do arquivo em cada recusa", () => {
    const result = parseCaixaCsv(buildCsv([ROW_AC, " 1;AC"]))

    expect(result.ok).toBe(true)
    if (!result.ok) return
    // 1 vazia, 2 título, 3 cabeçalho, 4 vazia, 5 e 6 registros.
    expect(result.rejected).toEqual([{ line: 6, reason: "campos" }])
  })
})

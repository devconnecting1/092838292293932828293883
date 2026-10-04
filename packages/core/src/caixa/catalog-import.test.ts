import { describe, expect, it } from "vitest"

import {
  CAIXA_IMPORT_BATCH_SIZE,
  type CaixaCatalogWriter,
  type CaixaSourceFingerprint,
  type CaixaSyncOrigin,
  decodeCaixaCsvBytes,
  EMPTY_CAIXA_SOURCE,
  processCaixaListText,
} from "./catalog-import"
import { CAIXA_CSV_COLUMNS } from "./csv"

/** Cabeçalho e título como a Caixa publica (linhas 2 e 3 do arquivo). */
const HEADER = ` ${CAIXA_CSV_COLUMNS.join(";")}`
const TITLE = " Lista de Imóveis da Caixa;;Data de geração:;15/09/2026;;;;;;;"

/** Registros reais do arquivo de 15/09/2026, com os espaços que a Caixa manda. */
const ROW_AC =
  " 1555518212585 ;AC ;BUJARI ;CENTRO ;RUA PROJETADA 2, N. SN, LT 19 QD B ;170.000,00;170.000,00;0.00;Não;Casa, 0.00 de área total, 75.17 de área privativa, 360.00 de área do terreno.;Leilão SFI - Edital Único;https://venda-imoveis.caixa.gov.br/sistema/detalhe-imovel.asp?hdnimovel=1555518212585"

const ROW_ES =
  " 8787709515913 ;ES ;CARIACICA ;TUCUM ;RUA SAO PAULO APOSTOLO, N. 23, Apto 402, BLOCO 14 VG 147 ;134.287,99;222.179,00;39.56;Sim;Apartamento, 74.12 de área total, 56.82 de área privativa, 0.00 de área do terreno, 2 qto(s), varanda, a.serv, WC, 1 sala(s), cozinha, 1 vaga(s) de garagem.;Licitação Aberta;https://venda-imoveis.caixa.gov.br/sistema/detalhe-imovel.asp?hdnimovel=8787709515913"

/** Linha no mesmo formato dos registros reais, com número e UF variando. */
function syntheticRow(index: number, uf = index % 2 === 0 ? "SP" : "RJ") {
  const numero = String(1_000_000_000_000 + index)

  return ` ${numero} ;${uf} ;CIDADE ${index} ;CENTRO ;RUA DE TESTE, N. ${index} ;100.000,00;120.000,00;16.67;Sim;Apartamento, 70.00 de área total, 2 qto(s), 1 vaga(s) de garagem.;Venda Online;https://venda-imoveis.caixa.gov.br/sistema/detalhe-imovel.asp?hdnimovel=${numero}`
}

function buildCsv(rows: string[]) {
  return ["", TITLE, HEADER, "", ...rows, ""].join("\r\n")
}

/** Lista nacional de teste: 2 registros reais + 1.000 sintéticos (acima do piso). */
function nationalList(extraRows: string[] = []) {
  return buildCsv([
    ROW_AC,
    ROW_ES,
    ...Array.from({ length: 1_000 }, (_, i) => syntheticRow(i + 1)),
    ...extraRows,
  ])
}

/** Windows-1252, como a Caixa publica (todos os caracteres usados cabem em Latin-1). */
function cp1252Bytes(text: string) {
  return Uint8Array.from(text, (char) => {
    const code = char.charCodeAt(0)
    if (code > 0xff || (code >= 0x80 && code <= 0x9f)) {
      throw new Error(`caractere fora do Latin-1: ${char}`)
    }
    return code
  })
}

/**
 * Catálogo em memória com as mesmas regras das RPCs: upsert por número,
 * fechamento marca quem não veio na carga e devolve o total ativo.
 */
function fakeCatalog(options: { failIngest?: string; failFinish?: string } = {}) {
  const listings = new Map<string, { syncId: string; delisted: boolean }>()
  const calls = {
    ingest: [] as Parameters<CaixaCatalogWriter["ingestBatch"]>[0][],
    finish: [] as Parameters<CaixaCatalogWriter["finish"]>[0][],
    checks: [] as Parameters<CaixaCatalogWriter["recordCheck"]>[0][],
  }

  const writer: CaixaCatalogWriter = {
    async ingestBatch(input) {
      calls.ingest.push(input)

      if (options.failIngest) {
        return { ok: false, code: options.failIngest }
      }

      let inserted = 0
      let updated = 0

      for (const row of input.rows) {
        if (listings.has(row.numero)) {
          updated += 1
        } else {
          inserted += 1
        }
        listings.set(row.numero, { syncId: input.syncId, delisted: false })
      }

      return {
        ok: true,
        data: {
          received: input.rows.length,
          accepted: input.rows.length,
          inserted,
          updated,
          rejected: 0,
        },
      }
    },
    async finish(input) {
      calls.finish.push(input)

      if (options.failFinish) {
        return { ok: false, code: options.failFinish }
      }

      let delisted = 0

      for (const item of listings.values()) {
        if (item.syncId !== input.syncId && !item.delisted) {
          item.delisted = true
          delisted += 1
        }
      }

      const total = [...listings.values()].filter((item) => !item.delisted).length

      return { ok: true, data: { delisted, total, checks_since_change: 0 } }
    },
    async recordCheck(input) {
      calls.checks.push(input)
      return calls.checks.length
    },
  }

  return { writer, calls, listings }
}

/** Identificador de carga previsível e diferente a cada carga, como o UUID real. */
let lastSyncId = 0

function nextSyncId() {
  lastSyncId += 1
  return `00000000-0000-4000-8000-${String(lastSyncId).padStart(12, "0")}`
}

function withoutSyncId<T extends { syncId: string }>(call: T | undefined) {
  if (!call) return undefined
  const { syncId, ...rest } = call
  expect(syncId).toMatch(/^[0-9a-f-]{36}$/)
  return rest
}

const DIGEST = "a".repeat(64)
const MANUAL_SOURCE: CaixaSourceFingerprint = { lastModified: null, etag: null, digest: DIGEST }

function run(
  text: string,
  writer: CaixaCatalogWriter,
  overrides: {
    origin?: CaixaSyncOrigin
    source?: CaixaSourceFingerprint
    previous?: CaixaSourceFingerprint
    mode?: "gravar" | "simular"
  } = {}
) {
  return processCaixaListText(
    {
      text,
      source: overrides.source ?? MANUAL_SOURCE,
      previous: overrides.previous ?? EMPTY_CAIXA_SOURCE,
      origin: overrides.origin ?? "envio_manual",
      mode: overrides.mode ?? "gravar",
      newSyncId: nextSyncId,
    },
    writer
  )
}

describe("processCaixaListText", () => {
  it("dá o mesmo resultado e as mesmas gravações para o mesmo texto, qualquer que seja a origem", async () => {
    const text = nationalList()
    const manual = fakeCatalog()
    const automatic = fakeCatalog()

    const fromUpload = await run(text, manual.writer, { origin: "envio_manual" })
    const fromDownload = await run(text, automatic.writer, { origin: "download_automatico" })

    expect(fromUpload).toEqual(fromDownload)
    expect(fromUpload).toEqual({
      ok: true,
      result: "changed",
      generatedOn: "2026-09-15",
      received: 1_002,
      accepted: 1_002,
      inserted: 1_002,
      updated: 0,
      rejected: 0,
      delisted: 0,
      total: 1_002,
      batches: 3,
      checksSinceChange: 0,
      file: {
        generatedOn: "2026-09-15",
        accepted: 1_002,
        rejected: 0,
        rejectedByReason: {},
        states: 4,
      },
    })

    // Mesmos lotes, na mesma ordem, com as mesmas linhas (só o id da carga muda).
    expect(manual.calls.ingest.map(withoutSyncId)).toEqual(
      automatic.calls.ingest.map(withoutSyncId)
    )
    expect(manual.calls.ingest.map((call) => call.rows.length)).toEqual([
      CAIXA_IMPORT_BATCH_SIZE,
      CAIXA_IMPORT_BATCH_SIZE,
      2,
    ])
    expect(manual.calls.ingest[0]?.rows[1]).toMatchObject({
      numero: "8787709515913",
      uf: "ES",
      cidade: "Cariacica",
      preco: 134_287.99,
      desconto: 39.56,
    })

    // O fechamento só difere na origem registrada.
    expect(manual.calls.finish).toHaveLength(1)
    expect(withoutSyncId(manual.calls.finish[0])).toEqual({
      ...withoutSyncId(automatic.calls.finish[0]),
      origin: "envio_manual",
    })
    expect(automatic.calls.finish[0]?.origin).toBe("download_automatico")
    expect(manual.calls.finish[0]).toMatchObject({
      generatedOn: "2026-09-15",
      rejected: 0,
      source: MANUAL_SOURCE,
    })
    expect(manual.calls.checks).toEqual([])
  })

  it("reenviar o mesmo arquivo não regrava nada", async () => {
    const catalog = fakeCatalog()

    const outcome = await run(nationalList(), catalog.writer, { previous: MANUAL_SOURCE })

    expect(outcome).toEqual({ ok: true, result: "unchanged", checksSinceChange: 1 })
    expect(catalog.calls.ingest).toEqual([])
    expect(catalog.calls.finish).toEqual([])
    expect(catalog.calls.checks).toEqual([
      { result: "unchanged", source: MANUAL_SOURCE, failureReason: null, origin: "envio_manual" },
    ])
  })

  it("mesmo sem a assinatura, gravar o mesmo arquivo de novo não duplica nem marca saída", async () => {
    const catalog = fakeCatalog()
    const text = nationalList()

    await run(text, catalog.writer)
    const again = await run(text, catalog.writer, {
      source: { ...MANUAL_SOURCE, digest: "b".repeat(64) },
      previous: MANUAL_SOURCE,
    })

    expect(again).toMatchObject({
      ok: true,
      result: "changed",
      inserted: 0,
      updated: 1_002,
      delisted: 0,
      total: 1_002,
    })
    expect(catalog.listings.size).toBe(1_002)
  })

  it("marca como fora da lista só quem sumiu do arquivo", async () => {
    const catalog = fakeCatalog()

    await run(nationalList([syntheticRow(5_000)]), catalog.writer)
    const next = await run(nationalList(), catalog.writer, {
      source: { ...MANUAL_SOURCE, digest: "c".repeat(64) },
      previous: MANUAL_SOURCE,
    })

    expect(next).toMatchObject({ ok: true, delisted: 1, total: 1_002 })
  })

  it("lê o arquivo de poucas linhas no formato real, mas não grava abaixo do piso", async () => {
    const catalog = fakeCatalog()

    const outcome = await run(buildCsv([ROW_AC, ROW_ES]), catalog.writer)

    expect(outcome).toEqual({
      ok: false,
      reason: "poucos_registros",
      detail: "2",
      file: {
        generatedOn: "2026-09-15",
        accepted: 2,
        rejected: 0,
        rejectedByReason: {},
        states: 2,
      },
    })
    expect(catalog.calls.ingest).toEqual([])
    expect(catalog.calls.checks).toEqual([
      { result: "falha", source: null, failureReason: "poucos_registros", origin: "envio_manual" },
    ])
  })

  it("recusa a lista de um estado só (baixada por engano no lugar da geral)", async () => {
    const catalog = fakeCatalog()
    const onlySp = buildCsv(Array.from({ length: 1_500 }, (_, i) => syntheticRow(i + 1, "SP")))

    const outcome = await run(onlySp, catalog.writer)

    expect(outcome).toMatchObject({ ok: false, reason: "lista_de_um_estado", detail: "SP" })
    expect(catalog.calls.ingest).toEqual([])
    expect(catalog.calls.checks[0]).toMatchObject({ failureReason: "lista_de_um_estado" })
  })

  it("aborta sem gravar quando o cabeçalho não é o da Caixa", async () => {
    const catalog = fakeCatalog()
    const text = nationalList().replace(";Desconto;", ";Abatimento;")

    const outcome = await run(text, catalog.writer)

    expect(outcome).toMatchObject({ ok: false, reason: "cabecalho_mudou" })
    expect(catalog.calls.ingest).toEqual([])
  })

  it("não fecha a carga quando um lote falha", async () => {
    const catalog = fakeCatalog({ failIngest: "57014" })

    const outcome = await run(nationalList(), catalog.writer)

    expect(outcome).toMatchObject({ ok: false, reason: "gravacao_falhou", detail: "57014" })
    expect(catalog.calls.ingest).toHaveLength(1)
    expect(catalog.calls.finish).toEqual([])
    expect(catalog.calls.checks[0]).toMatchObject({
      result: "falha",
      failureReason: "gravacao_falhou",
    })
  })

  it("avisa quando outra carga gravou imóveis ao mesmo tempo", async () => {
    const catalog = fakeCatalog({ failFinish: "40001" })

    const outcome = await run(nationalList(), catalog.writer)

    expect(outcome).toMatchObject({ ok: false, reason: "carga_simultanea" })
    expect(catalog.calls.checks[0]).toMatchObject({ failureReason: "carga_simultanea" })
  })
})

describe("processCaixaListText no modo simular", () => {
  it("valida igual à carga de verdade e não chama nenhuma RPC", async () => {
    const catalog = fakeCatalog()
    const invalidLine = " 1;AC"

    const outcome = await run(nationalList([invalidLine, ROW_AC]), catalog.writer, {
      mode: "simular",
      previous: MANUAL_SOURCE,
    })

    expect(outcome).toEqual({
      ok: true,
      result: "simulated",
      batches: 3,
      file: {
        generatedOn: "2026-09-15",
        accepted: 1_002,
        rejected: 2,
        rejectedByReason: { campos: 1, numero_repetido: 1 },
        states: 4,
      },
    })
    expect(catalog.calls).toEqual({ ingest: [], finish: [], checks: [] })
  })

  it("recusa pelos mesmos motivos, sem registrar falha", async () => {
    const catalog = fakeCatalog()
    const text = buildCsv([ROW_AC, ROW_ES])

    const simulated = await run(text, catalog.writer, { mode: "simular" })
    const real = await run(text, fakeCatalog().writer)

    expect(simulated).toEqual(real)
    expect(catalog.calls.checks).toEqual([])
  })
})

describe("decodeCaixaCsvBytes", () => {
  it("lê o arquivo em Windows-1252, como a Caixa publica", async () => {
    const text = decodeCaixaCsvBytes(cp1252Bytes(nationalList()))
    const catalog = fakeCatalog()

    expect(text).toContain("N° do imóvel")
    expect(await run(text, catalog.writer)).toMatchObject({ ok: true, total: 1_002 })
    expect(catalog.calls.ingest[0]?.rows[0]).toMatchObject({
      modalidade: "Leilão SFI - Edital Único",
    })
  })

  it("lê o mesmo conteúdo salvo de novo como CSV UTF-8 (com BOM)", () => {
    const original = nationalList()
    const utf8 = new TextEncoder().encode(`\uFEFF${original}`)

    expect(decodeCaixaCsvBytes(utf8)).toBe(original)
    expect(decodeCaixaCsvBytes(cp1252Bytes(original))).toBe(original)
  })
})

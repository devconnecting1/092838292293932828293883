import { describe, expect, it } from "vitest"

import { isValidCpf } from "../br/documents"
import { suggestColumnMapping } from "./mapping"
import {
  buildImportErrorsCsv,
  buildImportTemplateCsv,
  describeImportIssue,
  splitImportBatches,
  summarizeImport,
  type ImportRowOutcome,
} from "./report"
import { toLookupRow, validateImportRows, type ImportSourceRow } from "./validate"

const members = [
  { id: "00000000-0000-4000-8000-000000000001", name: "Carla Souza", email: "carla@imob.com.br" },
  { id: "00000000-0000-4000-8000-000000000002", name: "Diego Lima", email: "diego@imob.com.br" },
]

function rows(records: string[][]): ImportSourceRow[] {
  return records.map((cells, index) => ({ line: index + 2, cells }))
}

/** CPF válido a partir de um número de 9 dígitos. */
function cpfFrom(base: number): string {
  const digits = String(base).padStart(9, "0")

  for (let dv = 0; dv < 100; dv += 1) {
    const candidate = digits + String(dv).padStart(2, "0")

    if (isValidCpf(candidate)) {
      return candidate
    }
  }

  throw new Error("sem CPF")
}

describe("validateImportRows: clientes", () => {
  const headers = [
    "Nome",
    "Telefone",
    "WhatsApp",
    "E-mail",
    "CPF",
    "UF",
    "Responsável",
    "Etiquetas",
  ]
  const mapping = suggestColumnMapping("clients", headers)

  it("normaliza a linha para as colunas do banco", () => {
    const result = validateImportRows(
      "clients",
      rows([
        [
          "  Ana   Paula ",
          "(11) 98765-4321",
          "",
          "ANA@Exemplo.com",
          "529.982.247-25",
          "São Paulo",
          "carla@imob.com.br",
          "vip, comprador",
        ],
      ]),
      mapping,
      { members }
    )

    expect(result.rejected).toEqual([])
    expect(result.ready).toHaveLength(1)
    expect(result.ready[0]?.payload).toEqual({
      row: 2,
      name: "Ana Paula",
      phone: "11987654321",
      email: "ana@exemplo.com",
      document: "52998224725",
      kind: "pf",
      state: "SP",
      assigned_to: "00000000-0000-4000-8000-000000000001",
      tags: ["vip", "comprador"],
    })
  })

  it("lista o motivo de cada linha com erro", () => {
    const result = validateImportRows(
      "clients",
      rows([
        ["", "(11) 98765-4321", "", "", "", "", "", ""],
        ["Bruno", "9876-5432", "", "", "", "", "", ""],
        ["Carla", "", "", "carla@", "", "", "", ""],
        ["Davi", "", "", "", "", "", "", ""],
        ["Elisa", "", "", "", "123.456.789-00", "", "", ""],
      ]),
      mapping,
      { members }
    )

    expect(result.ready).toEqual([])
    expect(
      result.rejected.map((row) => [
        row.line,
        row.issues.map((issue) => describeImportIssue("clients", issue)),
      ])
    ).toEqual([
      [2, ["Nome vazio"]],
      [3, ["Telefone inválido: informe DDD e número"]],
      [4, ["E-mail inválido"]],
      [5, ["Sem telefone, WhatsApp, e-mail ou CPF/CNPJ"]],
      [6, ["CPF ou CNPJ inválido"]],
    ])
  })

  it("marca duplicados no arquivo por telefone, e-mail ou CPF", () => {
    const result = validateImportRows(
      "clients",
      rows([
        ["Ana", "(11) 98765-4321", "", "", "", "", "", ""],
        ["Ana de novo", "11987654321", "", "", "", "", "", ""],
        ["Outra", "", "+55 11 98765-4321", "", "", "", "", ""],
        ["Bia", "", "", "bia@x.com", "", "", "", ""],
        ["Bia 2", "", "", "BIA@x.com", "", "", "", ""],
        ["Caio", "", "", "", "529.982.247-25", "", "", ""],
        ["Caio 2", "", "", "", "52998224725", "", "", ""],
      ]),
      mapping,
      { members }
    )

    expect(result.ready.map((row) => row.line)).toEqual([2, 5, 7])
    expect(result.fileDuplicates.map((row) => [row.line, row.issues[0]?.duplicateOf])).toEqual([
      [3, 2],
      [4, 2],
      [6, 5],
      [8, 7],
    ])
  })

  it("avisa quando o responsável não é da equipe e segue sem responsável", () => {
    const result = validateImportRows(
      "clients",
      rows([["Ana", "11987654321", "", "", "", "", "fulano@outra.com", ""]]),
      mapping,
      { members }
    )

    expect(result.ready[0]?.payload.assigned_to).toBeUndefined()
    expect(result.ready[0]?.warnings).toEqual([{ code: "member_not_found", field: "assigned_to" }])
  })

  it("aceite: 2.000 contatos com 60 linhas ruins dão 1.940 prontas e 60 listadas", () => {
    const records: string[][] = []

    for (let index = 0; index < 2000; index += 1) {
      const phone = `119${String(10_000_000 + index)}`
      const bad = index % 100 < 3

      records.push([
        `Contato ${index}`,
        bad && index % 2 === 0 ? "12345" : phone,
        "",
        bad && index % 2 === 1 ? "sem-arroba" : `contato${index}@exemplo.com`,
        cpfFrom(100_000_000 + index),
        "SP",
        "",
        "",
      ])
    }

    const result = validateImportRows("clients", rows(records), mapping, { members })

    expect(result.totalRows).toBe(2000)
    expect(result.ready).toHaveLength(1940)
    expect(result.rejected).toHaveLength(60)
    expect(result.fileDuplicates).toHaveLength(0)

    const batches = splitImportBatches(result.ready)
    expect(batches).toHaveLength(10)
    expect(batches.flat()).toHaveLength(1940)

    // O banco devolve importado para todas as enviadas.
    const outcomes: ImportRowOutcome[] = batches
      .flat()
      .map((payload) => ({ row: payload.row, status: "inserted" }))
    const { summary, problems } = summarizeImport(result, outcomes)

    expect(summary).toEqual({
      totalRows: 2000,
      inserted: 1940,
      updated: 0,
      skipped: 0,
      failed: 60,
      drafts: 0,
    })
    expect(problems).toHaveLength(60)

    // Reimportar o mesmo arquivo: o banco devolve "já existe" para todas.
    const again = summarizeImport(
      result,
      outcomes.map((outcome) => ({ ...outcome, status: "skipped", code: "duplicate_in_base" }))
    )

    expect(again.summary.inserted).toBe(0)
    expect(again.summary.skipped).toBe(1940)
  })
})

describe("validateImportRows: leads", () => {
  const mapping = suggestColumnMapping("leads", [
    "Nome",
    "Celular",
    "E-mail",
    "Etapa",
    "Interesse",
    "Origem",
  ])

  it("traduz etapa, interesse e origem", () => {
    const result = validateImportRows(
      "leads",
      rows([["João", "21 99876-5432", "", "Em contato", "Alugar", "Instagram"]]),
      mapping,
      { members }
    )

    expect(result.ready[0]?.payload).toEqual({
      row: 2,
      name: "João",
      phone: "21998765432",
      stage: "contacted",
      interest: "rent",
      source: "instagram",
    })
  })

  it("exige nome com 2 letras e algum contato", () => {
    const result = validateImportRows(
      "leads",
      rows([
        ["J", "21 99876-5432", "", "", "", ""],
        ["Maria", "", "", "", "", ""],
      ]),
      mapping,
      { members }
    )

    expect(result.rejected.map((row) => row.issues.map((issue) => issue.code))).toEqual([
      ["invalid_name"],
      ["required_contact"],
    ])
  })
})

describe("validateImportRows: imóveis", () => {
  const headers = [
    "Código",
    "Tipo",
    "Finalidade",
    "Preço de venda",
    "Aluguel",
    "Área útil",
    "Área do terreno",
    "Quartos",
    "Suítes",
    "Bairro",
    "Características",
    "Situação",
  ]
  const mapping = suggestColumnMapping("properties", headers)

  it("usa os enums reais, gera o título e traduz características", () => {
    const result = validateImportRows(
      "properties",
      rows([
        [
          "AP-10",
          "Apto",
          "Venda",
          "R$ 850.000,00",
          "",
          "72,5",
          "",
          "2",
          "1",
          "Moema",
          "Piscina, Vista",
          "Ativo",
        ],
      ]),
      mapping,
      { members, resolveFeature: (label) => (label === "Piscina" ? "pool" : label) }
    )

    expect(result.rejected).toEqual([])
    expect(result.ready[0]?.payload).toEqual({
      row: 2,
      external_code: "AP-10",
      type: "apartment",
      purpose: "sale",
      sale_price: 850000,
      living_area: 72.5,
      bedrooms: 2,
      suites: 1,
      neighborhood: "Moema",
      title: "Apartamento em Moema",
      title_generated: true,
      status: "active",
      usage: "residential",
      features: ["pool", "Vista"],
    })
    expect(result.ready[0]?.warnings).toEqual([])
  })

  it("deduz a finalidade pelos preços e avisa que falta o mínimo para ativo", () => {
    const result = validateImportRows(
      "properties",
      rows([["", "Terreno", "", "", "3.500", "", "", "", "", "Centro", "", ""]]),
      mapping,
      { members }
    )

    expect(result.ready[0]?.payload.purpose).toBe("rent")
    expect(result.ready[0]?.payload.usage).toBe("residential")
    expect(result.ready[0]?.warnings).toEqual([{ code: "will_be_draft" }])
  })

  it("recusa tipo desconhecido e preço que não é número", () => {
    const result = validateImportRows(
      "properties",
      rows([
        ["", "Castelo", "Venda", "100000", "", "", "", "", "", "", "", ""],
        ["", "Casa", "Venda", "a combinar", "", "", "", "", "", "", "", ""],
      ]),
      mapping,
      { members }
    )

    expect(result.rejected.map((row) => row.issues.map((issue) => issue.code))).toEqual([
      ["required_type"],
      ["invalid_number"],
    ])
  })

  it("duplicado no arquivo pelo código ou, sem código, pelo endereço", () => {
    const result = validateImportRows(
      "properties",
      rows([
        ["AP-1", "Apto", "Venda", "100000", "", "50", "", "", "", "Centro", "", ""],
        ["AP-1", "Casa", "Venda", "200000", "", "90", "", "", "", "Centro", "", ""],
        ["", "Casa", "Locação", "", "2000", "90", "", "", "", "Jardins", "", ""],
        ["", "casa", "aluguel", "", "2100", "90", "", "", "", "JARDINS", "", ""],
      ]),
      mapping,
      { members }
    )

    expect(result.ready.map((row) => row.line)).toEqual([2, 4])
    expect(result.fileDuplicates.map((row) => row.line)).toEqual([3, 5])
  })

  it("a busca na base só manda os campos de duplicidade", () => {
    const result = validateImportRows(
      "properties",
      rows([["AP-1", "Apto", "Venda", "100000", "", "50", "", "3", "", "Centro", "", ""]]),
      mapping,
      { members }
    )
    const payload = result.ready[0]?.payload

    expect(payload && toLookupRow("properties", payload)).toEqual({
      row: 2,
      external_code: "AP-1",
      type: "apartment",
      purpose: "sale",
      title: "Apartamento em Centro",
      neighborhood: "Centro",
    })
  })
})

describe("arquivos da importação", () => {
  it("modelo de planilha tem BOM, ponto e vírgula e uma linha de exemplo", () => {
    const csv = buildImportTemplateCsv("leads")
    const [head, example] = csv.replace(/^\p{Cf}/u, "").split("\r\n")

    expect(csv.charCodeAt(0)).toBe(0xfeff)
    expect(head?.startsWith("Nome;Telefone;E-mail;Etapa")).toBe(true)
    expect(example?.startsWith("João Pereira;(21) 99876-5432;joao@exemplo.com")).toBe(true)
  })

  it("CSV de erros traz linha, motivo e as colunas originais", () => {
    const csv = buildImportErrorsCsv(
      ["Nome", "Telefone"],
      [{ line: 3, status: "failed", reason: "Telefone inválido: informe DDD e número" }],
      new Map([[3, ["Bruno", "9876-5432"]]])
    )

    expect(csv.split("\r\n")[1]).toBe("3;Telefone inválido: informe DDD e número;Bruno;9876-5432")
  })

  it("lotes respeitam o limite de bytes", () => {
    const ready = Array.from({ length: 10 }, (_, index) => ({
      line: index + 2,
      payload: { row: index + 2, description: "x".repeat(1000) },
      warnings: [],
    }))

    const batches = splitImportBatches(ready, { maxRows: 200, maxBytes: 3_500 })
    expect(batches.map((batch) => batch.length)).toEqual([3, 3, 3, 1])
  })
})

describe("validateImportRows: datas do lead, proprietários e fotos", () => {
  const now = new Date("2026-09-17T12:00:00-03:00")

  it("leva as datas originais do lead e recusa ordem trocada", () => {
    const mapping = suggestColumnMapping("leads", [
      "Nome",
      "Celular",
      "Etapa",
      "Data de entrada",
      "Data do 1º contato",
      "Data de ganho",
    ])

    expect(mapping).toEqual([
      "name",
      "phone",
      "stage",
      "received_at",
      "first_contact_at",
      "closed_at",
    ])

    const result = validateImportRows(
      "leads",
      rows([
        ["Ana", "21 99876-5432", "Ganho", "10/03/2025 09:15", "10/03/2025 10:40", "20/03/2025"],
        ["Bia", "21 99876-5433", "Novo", "10/03/2025", "01/03/2025", ""],
        ["Caio", "21 99876-5434", "Em contato", "31/02/2025", "", ""],
      ]),
      mapping,
      { members, now }
    )

    expect(result.ready[0]?.payload).toMatchObject({
      received_at: "2025-03-10T09:15:00-03:00",
      first_contact_at: "2025-03-10T10:40:00-03:00",
      closed_at: "2025-03-20T12:00:00-03:00",
    })
    expect(result.rejected.map((row) => row.issues.map((issue) => issue.code))).toEqual([
      ["invalid_date_order"],
      ["invalid_date"],
    ])
  })

  it("monta proprietários e links de foto do imóvel", () => {
    const mapping = suggestColumnMapping("properties", [
      "Tipo",
      "Finalidade",
      "Preço de venda",
      "Proprietário",
      "CPF do proprietário",
      "Telefone do proprietário",
      "Percentual do proprietário",
      "Fotos",
    ])

    expect(mapping.slice(3)).toEqual([
      "owner_name",
      "owner_document",
      "owner_phone",
      "owner_share",
      "photo_urls",
    ])

    const result = validateImportRows(
      "properties",
      rows([
        [
          "Apartamento",
          "Venda",
          "500.000",
          "Maria | João",
          "529.982.247-25 |",
          " | 11 98765-4321",
          "60 | 40",
          "https://exemplo.com/1.jpg | https://exemplo.com/2.jpg",
        ],
        ["Casa", "Venda", "1", "Ana | Beto", "", "11 98765-4321 | 11 98765-4322", "50 | 40", ""],
        ["Casa", "Venda", "2", "", "", "", "", "foto1.jpg"],
      ]),
      mapping,
      { members, now }
    )

    expect(result.ready[0]?.payload).toMatchObject({
      owners: [
        { name: "Maria", document: "52998224725", share_percent: 60 },
        { name: "João", phone: "11987654321", share_percent: 40 },
      ],
      photo_urls: ["https://exemplo.com/1.jpg", "https://exemplo.com/2.jpg"],
    })
    expect(result.rejected.map((row) => row.issues.map((issue) => issue.code))).toEqual([
      ["invalid_owner_share"],
      ["invalid_photo_link"],
    ])
  })
})

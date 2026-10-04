import { describe, expect, it } from "vitest"

import {
  buildCsvDocument,
  buildCsvHead,
  buildCsvLines,
  buildCsvRow,
  CSV_BOM,
  csvFileName,
  escapeCsvValue,
  formatCsvNumber,
} from "./csv"

describe("escapeCsvValue", () => {
  it("deixa passar texto simples", () => {
    expect(escapeCsvValue("Maria Silva")).toBe("Maria Silva")
  })

  it("trata vazio como célula vazia", () => {
    expect(escapeCsvValue(null)).toBe("")
    expect(escapeCsvValue(undefined)).toBe("")
    expect(escapeCsvValue("")).toBe("")
  })

  it("põe entre aspas o texto que tem o separador, aspas ou quebra de linha", () => {
    expect(escapeCsvValue("Rua A, 10; sala 2")).toBe('"Rua A, 10; sala 2"')
    expect(escapeCsvValue('Ele disse "sim"')).toBe('"Ele disse ""sim"""')
    expect(escapeCsvValue("primeira\nsegunda")).toBe('"primeira\nsegunda"')
  })

  it("preserva o espaço das pontas com aspas (o Excel comeria sem elas)", () => {
    expect(escapeCsvValue("  sobrou espaço  ")).toBe('"  sobrou espaço  "')
  })

  it("desarma fórmula vinda de texto do formulário público", () => {
    expect(escapeCsvValue("=1+1")).toBe("'=1+1")
    expect(escapeCsvValue("@SUM(A1)")).toBe("'@SUM(A1)")
    expect(escapeCsvValue("+55 11 99999-0000")).toBe("'+55 11 99999-0000")
    expect(escapeCsvValue("-nome suspeito")).toBe("'-nome suspeito")
  })

  it("não desarma número: negativo continua sendo número na planilha", () => {
    expect(escapeCsvValue(-1234.5)).toBe("-1234,5")
  })

  it("escreve booleano em pt-BR", () => {
    expect(escapeCsvValue(true)).toBe("Sim")
    expect(escapeCsvValue(false)).toBe("Não")
  })
})

describe("formatCsvNumber", () => {
  it("usa vírgula decimal e não usa separador de milhar", () => {
    expect(formatCsvNumber(1234567.89)).toBe("1234567,89")
    expect(formatCsvNumber(0.5)).toBe("0,5")
    expect(formatCsvNumber(500000)).toBe("500000")
  })

  it("some com o zero negativo e com valor não finito", () => {
    expect(formatCsvNumber(-0)).toBe("0")
    expect(formatCsvNumber(Number.NaN)).toBe("")
    expect(formatCsvNumber(Number.POSITIVE_INFINITY)).toBe("")
  })
})

describe("buildCsvRow", () => {
  it("junta as células com ponto e vírgula", () => {
    expect(buildCsvRow(["Maria", 3, null, true])).toBe("Maria;3;;Sim")
  })
})

describe("buildCsvHead", () => {
  it("começa com o BOM e termina em CRLF", () => {
    const head = buildCsvHead(["Corretor", "Leads"])

    expect(head.startsWith(CSV_BOM)).toBe(true)
    expect(head).toBe(`${CSV_BOM}Corretor;Leads\r\n`)
  })
})

describe("buildCsvLines", () => {
  it("devolve vazio quando não há linha (páginas do fim da exportação)", () => {
    expect(buildCsvLines([])).toBe("")
  })

  it("termina cada linha em CRLF", () => {
    expect(
      buildCsvLines([
        ["Maria", 3],
        ["João", 1],
      ])
    ).toBe("Maria;3\r\nJoão;1\r\n")
  })
})

describe("buildCsvDocument", () => {
  it("monta o arquivo inteiro do relatório agregado", () => {
    const csv = buildCsvDocument(
      ["Corretor", "Leads", "Conversão (%)"],
      [
        ["Maria", 10, 25.5],
        ["João; o outro", 4, null],
      ]
    )

    expect(csv).toBe(
      `${CSV_BOM}Corretor;Leads;Conversão (%)\r\nMaria;10;25,5\r\n"João; o outro";4;\r\n`
    )
  })
})

describe("csvFileName", () => {
  it("monta o nome com o período e sem acento nem espaço", () => {
    expect(
      csvFileName("Relatório por corretor", { fromDay: "2026-09-01", toDay: "2026-09-16" })
    ).toBe("relatorio-por-corretor_2026-09-01_2026-09-16.csv")
  })

  it("não deixa passar aspas nem barra para o Content-Disposition", () => {
    expect(csvFileName('../"leads"', { fromDay: "2026-01-01", toDay: "2026-01-31" })).toBe(
      "leads_2026-01-01_2026-01-31.csv"
    )
  })

  it("cai num nome genérico quando não sobra nada do prefixo", () => {
    expect(csvFileName("///", { fromDay: "2026-01-01", toDay: "2026-01-01" })).toBe(
      "relatorio_2026-01-01_2026-01-01.csv"
    )
  })
})

import { describe, expect, it } from "vitest"

import { decodeCsvBytes, detectCsvDelimiter, parseCsv, readCsvBytes } from "./csv"

function windows1252(text: string): Uint8Array {
  // Só os caracteres usados nos testes: ASCII e Latin-1 têm o mesmo código.
  return Uint8Array.from([...text].map((char) => char.charCodeAt(0)))
}

describe("decodeCsvBytes", () => {
  it("lê UTF-8 com BOM e tira o BOM", () => {
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode("Imóvel;Preço")])
    expect(decodeCsvBytes(bytes)).toEqual({ text: "Imóvel;Preço", encoding: "utf-8" })
  })

  it("lê UTF-8 sem BOM", () => {
    const bytes = new TextEncoder().encode("Conceição")
    expect(decodeCsvBytes(bytes)).toEqual({ text: "Conceição", encoding: "utf-8" })
  })

  it("cai para Windows-1252 quando os bytes não são UTF-8 (Excel do Windows)", () => {
    const bytes = windows1252("Nome;Endereço;Observação")
    expect(decodeCsvBytes(bytes)).toEqual({
      text: "Nome;Endereço;Observação",
      encoding: "windows-1252",
    })
  })
})

describe("detectCsvDelimiter", () => {
  it("escolhe ponto e vírgula no CSV do Excel em pt-BR", () => {
    expect(detectCsvDelimiter("Nome;Telefone;Preço\nAna;11999998888;1.234,56")).toBe(";")
  })

  it("escolhe vírgula no CSV do Google Planilhas", () => {
    expect(detectCsvDelimiter("Nome,Telefone,Cidade\nAna,11999998888,Campinas")).toBe(",")
  })

  it("não conta vírgula dentro de aspas", () => {
    expect(detectCsvDelimiter('Nome;Endereço\n"Silva, Ana";"Rua A, 10, apto 2"')).toBe(";")
  })
})

describe("parseCsv", () => {
  it("separa campos e linhas com CRLF, LF e CR", () => {
    expect(parseCsv("a;b\r\nc;d\ne;f\rg;h", ";")).toEqual([
      ["a", "b"],
      ["c", "d"],
      ["e", "f"],
      ["g", "h"],
    ])
  })

  it("respeita aspas com separador, aspas dobradas e quebra de linha", () => {
    expect(parseCsv('nome,obs\n"Silva, Ana","Disse ""sim""\nligar depois"', ",")).toEqual([
      ["nome", "obs"],
      ["Silva, Ana", 'Disse "sim"\nligar depois'],
    ])
  })

  it("mantém campos vazios e ignora a quebra de linha final", () => {
    expect(parseCsv("a;;c\n;;\n", ";")).toEqual([
      ["a", "", "c"],
      ["", "", ""],
    ])
  })
})

describe("readCsvBytes", () => {
  it("detecta encoding e separador de uma vez", () => {
    const result = readCsvBytes(windows1252("Nome;Cidade\nJoão;São Paulo\n"))
    expect(result.encoding).toBe("windows-1252")
    expect(result.delimiter).toBe(";")
    expect(result.records).toEqual([
      ["Nome", "Cidade"],
      ["João", "São Paulo"],
    ])
  })
})

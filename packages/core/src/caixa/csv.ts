/**
 * Leitor do `Lista_imoveis_geral.csv` da Caixa.
 *
 * O arquivo é dado **não confiável** e é lido com desconfiança:
 *
 * - o cabeçalho tem que bater exatamente com as 12 colunas conhecidas, senão a
 *   carga inteira é abortada e o dado de ontem continua valendo (é a defesa
 *   contra uma mudança silenciosa de formato);
 * - cada linha é validada sozinha: a inválida é recusada e contada, sem
 *   derrubar as outras;
 * - número repetido no mesmo arquivo é recusado (a primeira ocorrência vence),
 *   porque o upsert em lote não pode tocar a mesma chave duas vezes;
 * - o link só é aceito se apontar para o site da Caixa — ele vira `href` na tela.
 *
 * Função pura: recebe o texto já decodificado (CP1252 → UTF-8) e devolve o que
 * entrou, o que foi recusado e por quê.
 */

import type { PropertyType } from "../properties/enums"
import { parseCaixaDescription } from "./description"
import {
  normalizeCityName,
  normalizeListingNumber,
  normalizeNeighborhoodName,
  normalizePlainText,
  normalizeUf,
  parseBrDate,
  parseBrlAmount,
  parsePercent,
  parseYesNo,
} from "./normalize"
import { isCaixaUrl } from "./source"

/** As 12 colunas da linha de cabeçalho, na ordem em que a Caixa publica. */
export const CAIXA_CSV_COLUMNS = [
  "N° do imóvel",
  "UF",
  "Cidade",
  "Bairro",
  "Endereço",
  "Preço",
  "Valor de avaliação",
  "Desconto",
  "Financiamento",
  "Descrição",
  "Modalidade de venda",
  "Link de acesso",
] as const

/** Linhas do começo do arquivo em que o cabeçalho pode estar (hoje é a 3ª). */
const HEADER_SEARCH_LIMIT = 10

/** Teto defensivo de registros: o arquivo tem ~8.100; 10⁵ já é absurdo. */
const MAX_ROWS = 100_000

export type CaixaListingRow = {
  numero: string
  uf: string
  cidade: string
  bairro: string | null
  endereco: string
  preco: number
  valorAvaliacao: number | null
  /** Percentual **publicado** pela Caixa (coluna 8). Nunca calculado por nós. */
  desconto: number | null
  aceitaFinanciamento: boolean | null
  descricao: string | null
  modalidade: string | null
  link: string
  tipo: PropertyType
  areaTotal: number | null
  areaPrivativa: number | null
  areaTerreno: number | null
  quartos: number | null
  vagas: number | null
}

export type CaixaRejectionReason =
  | "campos"
  | "numero"
  | "numero_repetido"
  | "uf"
  | "cidade"
  | "endereco"
  | "preco"
  | "link"
  | "limite"

export type CaixaCsvRejection = {
  /** Linha do arquivo (1 é a primeira), para achar o registro problemático. */
  line: number
  reason: CaixaRejectionReason
}

export type CaixaCsvParseResult =
  | {
      ok: false
      /** `cabecalho`: as colunas não batem. `vazio`: nenhum registro utilizável. */
      reason: "cabecalho" | "vazio"
      /** Cabeçalho encontrado (recortado), para o log dizer o que mudou. */
      foundHeader: string | null
    }
  | {
      ok: true
      /** Data de geração declarada pela própria Caixa (linha 2), em ISO. */
      generatedOn: string | null
      rows: CaixaListingRow[]
      rejected: CaixaCsvRejection[]
    }

/** Compara nomes de coluna sem acento, espaço nem pontuação. */
function foldHeaderCell(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
}

const EXPECTED_HEADER = CAIXA_CSV_COLUMNS.map(foldHeaderCell)

function isHeaderLine(cells: string[]): boolean {
  return (
    cells.length === EXPECTED_HEADER.length &&
    cells.every((cell, index) => foldHeaderCell(cell) === EXPECTED_HEADER[index])
  )
}

/** Data de geração: a célula seguinte a "Data de geração:" nas linhas do topo. */
function readGeneratedOn(preamble: string[][]): string | null {
  for (const cells of preamble) {
    for (const [index, cell] of cells.entries()) {
      if (foldHeaderCell(cell).startsWith("datadegeracao")) {
        const next = cells.slice(index + 1).find((value) => value.trim().length > 0)
        const parsed = parseBrDate(next ?? null)

        if (parsed) {
          return parsed
        }
      }
    }
  }

  return null
}

function parseRow(cells: string[]): { row: CaixaListingRow } | { reason: CaixaRejectionReason } {
  if (cells.length !== CAIXA_CSV_COLUMNS.length) {
    return { reason: "campos" }
  }

  const numero = normalizeListingNumber(cells[0])
  if (!numero) {
    return { reason: "numero" }
  }

  const uf = normalizeUf(cells[1])
  if (!uf) {
    return { reason: "uf" }
  }

  const cidade = normalizeCityName(cells[2])
  if (!cidade) {
    return { reason: "cidade" }
  }

  const endereco = normalizePlainText(cells[4], 300)
  if (!endereco) {
    return { reason: "endereco" }
  }

  const preco = parseBrlAmount(cells[5])
  if (preco === null) {
    return { reason: "preco" }
  }

  // A coluna 12 vira href na tela: só link para o site da Caixa entra.
  const link = normalizePlainText(cells[11], 300)
  if (!link || !isCaixaUrl(link)) {
    return { reason: "link" }
  }

  const descricao = normalizePlainText(cells[9], 1000)
  const facts = parseCaixaDescription(descricao)

  return {
    row: {
      numero,
      uf,
      cidade,
      bairro: normalizeNeighborhoodName(cells[3]),
      endereco,
      preco,
      valorAvaliacao: parseBrlAmount(cells[6]),
      desconto: parsePercent(cells[7]),
      aceitaFinanciamento: parseYesNo(cells[8]),
      descricao,
      modalidade: normalizePlainText(cells[10], 80),
      link,
      tipo: facts.type,
      areaTotal: facts.totalArea,
      areaPrivativa: facts.privateArea,
      areaTerreno: facts.landArea,
      quartos: facts.bedrooms,
      vagas: facts.parkingSpaces,
    },
  }
}

/**
 * Lê o CSV inteiro. O texto precisa chegar já decodificado de CP1252; aqui só
 * se lida com a estrutura (`;` sem aspas, uma linha por imóvel).
 */
export function parseCaixaCsv(text: string): CaixaCsvParseResult {
  const lines = text.split(/\r?\n/)
  const preamble: string[][] = []
  let headerIndex = -1

  for (let index = 0; index < Math.min(lines.length, HEADER_SEARCH_LIMIT); index += 1) {
    const cells = (lines[index] ?? "").split(";")

    if (isHeaderLine(cells)) {
      headerIndex = index
      break
    }

    preamble.push(cells)
  }

  if (headerIndex < 0) {
    // Para o log dizer o que mudou: a linha do topo com mais colunas é a que
    // mais se parece com o cabeçalho que deveria estar ali.
    let found: string | null = null
    let foundCells = 1

    for (const line of lines.slice(0, HEADER_SEARCH_LIMIT)) {
      const cells = line.split(";").length

      if (cells > foundCells) {
        found = line.slice(0, 300)
        foundCells = cells
      }
    }

    return { ok: false, reason: "cabecalho", foundHeader: found }
  }

  const rows: CaixaListingRow[] = []
  const rejected: CaixaCsvRejection[] = []
  const seen = new Set<string>()

  for (let index = headerIndex + 1; index < lines.length; index += 1) {
    const raw = lines[index] ?? ""

    // Linhas em branco de separação não são erro (o arquivo tem uma logo abaixo
    // do cabeçalho e outra, às vezes, no fim).
    if (raw.trim().length === 0) {
      continue
    }

    const line = index + 1

    if (rows.length >= MAX_ROWS) {
      rejected.push({ line, reason: "limite" })
      break
    }

    const parsed = parseRow(raw.split(";"))

    if ("reason" in parsed) {
      rejected.push({ line, reason: parsed.reason })
      continue
    }

    if (seen.has(parsed.row.numero)) {
      rejected.push({ line, reason: "numero_repetido" })
      continue
    }

    seen.add(parsed.row.numero)
    rows.push(parsed.row)
  }

  if (rows.length === 0) {
    return { ok: false, reason: "vazio", foundHeader: null }
  }

  return { ok: true, generatedOn: readGeneratedOn(preamble), rows, rejected }
}

/**
 * A coluna `Descrição` do CSV é texto livre, mas com gramática regular:
 *
 *   Apartamento, 74.12 de área total, 56.82 de área privativa, 0.00 de área do
 *   terreno, 2 qto(s), varanda, a.serv, WC, 1 sala(s), cozinha, 1 vaga(s) de garagem.
 *
 * Daqui saem os campos que dão filtro (tipo, áreas, quartos, vagas). O texto
 * original continua sendo guardado e exibido: o que não for reconhecido aqui
 * vira `null`, nunca um palpite.
 */

import type { PropertyType } from "../properties/enums"
import { parseDotDecimal } from "./normalize"

export type CaixaDescriptionFacts = {
  /** Tipo mapeado para o enum do CRM; `other` quando o rótulo não é conhecido. */
  type: PropertyType
  /** Primeiro termo da descrição, como veio ("Imóvel rural", "Gleba"). */
  rawType: string | null
  totalArea: number | null
  privateArea: number | null
  landArea: number | null
  bedrooms: number | null
  parkingSpaces: number | null
  livingRooms: number | null
}

/**
 * Rótulos observados nos 8.094 registros de 16/09/2026 (o primeiro termo antes
 * da vírgula cobre 100% das linhas). Rótulo novo cai em `other` — o módulo
 * segue funcionando e o texto original continua na tela.
 */
const TYPE_BY_LABEL: Record<string, PropertyType> = {
  apartamento: "apartment",
  casa: "house",
  sobrado: "house",
  terreno: "land",
  gleba: "land",
  "imovel rural": "farm",
  predio: "building",
  sala: "commercial_room",
  loja: "store",
  galpao: "warehouse",
  // "Comercial" é genérico demais para virar sala, loja ou galpão: fica em "Outro".
  comercial: "other",
  outros: "other",
}

const AREA_PATTERNS = {
  totalArea: /([\d.]+)\s+de\s+área\s+total/i,
  privateArea: /([\d.]+)\s+de\s+área\s+privativa/i,
  landArea: /([\d.]+)\s+de\s+área\s+do\s+terreno/i,
} as const

const COUNT_PATTERNS = {
  bedrooms: /(\d{1,3})\s*qto\(s\)/i,
  parkingSpaces: /(\d{1,3})\s*vaga\(s\)/i,
  livingRooms: /(\d{1,3})\s*sala\(s\)/i,
} as const

/** Sem acento e em minúsculas, para casar o rótulo do tipo. */
function foldLabel(value: string): string {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim()
}

/**
 * Área: `0.00` no arquivo significa "não informada" (todo Terreno tem
 * `0.00 de área total`), então vira `null` em vez de zero.
 */
function readArea(description: string, pattern: RegExp): number | null {
  const value = parseDotDecimal(pattern.exec(description)?.[1] ?? null)

  return value === null || value <= 0 ? null : value
}

function readCount(description: string, pattern: RegExp): number | null {
  const raw = pattern.exec(description)?.[1]

  if (!raw) {
    return null
  }

  const value = Number(raw)

  return Number.isInteger(value) && value > 0 && value <= 999 ? value : null
}

export function parseCaixaDescription(description: unknown): CaixaDescriptionFacts {
  if (typeof description !== "string" || description.trim().length === 0) {
    return {
      type: "other",
      rawType: null,
      totalArea: null,
      privateArea: null,
      landArea: null,
      bedrooms: null,
      parkingSpaces: null,
      livingRooms: null,
    }
  }

  const rawType = description.split(",")[0]?.trim() || null
  const type = (rawType && TYPE_BY_LABEL[foldLabel(rawType)]) || "other"

  return {
    type,
    rawType,
    totalArea: readArea(description, AREA_PATTERNS.totalArea),
    privateArea: readArea(description, AREA_PATTERNS.privateArea),
    landArea: readArea(description, AREA_PATTERNS.landArea),
    bedrooms: readCount(description, COUNT_PATTERNS.bedrooms),
    parkingSpaces: readCount(description, COUNT_PATTERNS.parkingSpaces),
    livingRooms: readCount(description, COUNT_PATTERNS.livingRooms),
  }
}

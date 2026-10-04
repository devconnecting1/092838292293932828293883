/**
 * Tradução dos valores escritos na planilha (pt-BR, com ou sem acento, do jeito
 * que os sistemas antigos exportam) para os enums reais do banco.
 */

import {
  PROPERTY_STATUS_LABELS,
  PROPERTY_TYPE_LABELS,
  type ListingPurpose,
  type PropertyStatus,
  type PropertyType,
  type PropertyUsage,
} from "../properties/enums"
import { normalizeLabel } from "./normalize"

type Dictionary<T extends string> = ReadonlyMap<string, T>

function dictionary<T extends string>(entries: Record<T, readonly string[]>): Dictionary<T> {
  const map = new Map<string, T>()

  for (const [value, synonyms] of Object.entries(entries) as [T, readonly string[]][]) {
    map.set(normalizeLabel(value), value)

    for (const synonym of synonyms) {
      map.set(normalizeLabel(synonym), value)
    }
  }

  return map
}

function lookup<T extends string>(map: Dictionary<T>, raw: string | null | undefined): T | null {
  if (!raw) {
    return null
  }

  return map.get(normalizeLabel(raw)) ?? null
}

// ---------------------------------------------------------------------------
// Imóveis
// ---------------------------------------------------------------------------

const PURPOSES = dictionary<ListingPurpose>({
  sale: ["venda", "vender", "a venda", "compra", "comprar", "vende se"],
  rent: ["locacao", "aluguel", "alugar", "locar", "para alugar", "aluga se", "arrendamento"],
  sale_rent: [
    "venda e locacao",
    "venda locacao",
    "venda ou locacao",
    "venda e aluguel",
    "venda aluguel",
    "venda ou aluguel",
    "locacao e venda",
    "aluguel e venda",
    "ambos",
    "ambas",
  ],
})

export function parsePurpose(raw: string | null | undefined): ListingPurpose | null {
  return lookup(PURPOSES, raw)
}

const TYPES = dictionary<PropertyType>({
  apartment: [
    PROPERTY_TYPE_LABELS.apartment,
    "apto",
    "ap",
    "apt",
    "apartamento padrao",
    "duplex",
    "triplex",
    "garden",
  ],
  house: [
    PROPERTY_TYPE_LABELS.house,
    "sobrado",
    "residencia",
    "casa terrea",
    "casa de vila",
    "edicula",
  ],
  condo_house: [
    PROPERTY_TYPE_LABELS.condo_house,
    "casa de condominio",
    "casa condominio",
    "condominio fechado",
    "casa em condominio fechado",
    "village",
  ],
  penthouse: [PROPERTY_TYPE_LABELS.penthouse, "penthouse", "cobertura duplex"],
  studio: [
    PROPERTY_TYPE_LABELS.studio,
    "studio",
    "estudio",
    "kitnet",
    "kitinete",
    "quitinete",
    "kit",
    "loft",
    "conjugado",
  ],
  flat: [PROPERTY_TYPE_LABELS.flat, "apart hotel", "apart-hotel"],
  land: [PROPERTY_TYPE_LABELS.land, "lote", "terreno em condominio", "area", "lote residencial"],
  commercial_room: [
    PROPERTY_TYPE_LABELS.commercial_room,
    "sala",
    "conjunto comercial",
    "conjunto",
    "consultorio",
  ],
  office: [PROPERTY_TYPE_LABELS.office, "escritorio comercial", "laje corporativa"],
  store: [PROPERTY_TYPE_LABELS.store, "ponto comercial", "loja comercial", "salao comercial"],
  warehouse: [PROPERTY_TYPE_LABELS.warehouse, "galpao", "barracao", "deposito", "armazem"],
  building: [PROPERTY_TYPE_LABELS.building, "predio", "edificio", "predio comercial"],
  farm: [PROPERTY_TYPE_LABELS.farm, "fazenda"],
  ranch: [PROPERTY_TYPE_LABELS.ranch, "sitio", "chacara", "rancho", "haras"],
  other: [PROPERTY_TYPE_LABELS.other, "outros"],
})

export function parsePropertyType(raw: string | null | undefined): PropertyType | null {
  return lookup(TYPES, raw)
}

const USAGES = dictionary<PropertyUsage>({
  residential: ["residencial", "moradia", "residencia"],
  commercial: ["comercial", "empresarial", "corporativo"],
  rural: ["rural", "agricola"],
  industrial: ["industrial", "logistico"],
})

export function parsePropertyUsage(raw: string | null | undefined): PropertyUsage | null {
  return lookup(USAGES, raw)
}

/** Uso quando a planilha não diz: segue o tipo do imóvel. */
export function inferPropertyUsage(type: PropertyType): PropertyUsage {
  switch (type) {
    case "commercial_room":
    case "office":
    case "store":
    case "building":
      return "commercial"
    case "warehouse":
      return "industrial"
    case "farm":
    case "ranch":
      return "rural"
    default:
      return "residential"
  }
}

const STATUSES = dictionary<PropertyStatus>({
  draft: [PROPERTY_STATUS_LABELS.draft, "em cadastro", "incompleto"],
  active: [
    PROPERTY_STATUS_LABELS.active,
    "disponivel",
    "a venda",
    "para venda",
    "para alugar",
    "publicado",
    "ativa",
    "livre",
  ],
  reserved: [PROPERTY_STATUS_LABELS.reserved, "reservada", "em negociacao", "proposta"],
  sold: [PROPERTY_STATUS_LABELS.sold, "vendida"],
  rented: [PROPERTY_STATUS_LABELS.rented, "alugada", "locado", "locada"],
  inactive: [
    PROPERTY_STATUS_LABELS.inactive,
    "inativa",
    "suspenso",
    "indisponivel",
    "cancelado",
    "desativado",
    "retirado",
  ],
})

export function parsePropertyStatus(raw: string | null | undefined): PropertyStatus | null {
  return lookup(STATUSES, raw)
}

// ---------------------------------------------------------------------------
// Leads
// ---------------------------------------------------------------------------

export type ImportLeadStage =
  "new" | "contacted" | "qualified" | "visit_scheduled" | "proposal" | "won" | "lost"

const LEAD_STAGES = dictionary<ImportLeadStage>({
  new: ["novo", "nova", "aberto", "entrada", "nao atendido"],
  contacted: [
    "em contato",
    "contatado",
    "contato feito",
    "em atendimento",
    "atendimento",
    "contato",
  ],
  qualified: ["qualificado", "qualificada", "interessado", "quente"],
  visit_scheduled: ["visita agendada", "visita", "agendado", "visita marcada"],
  proposal: ["proposta", "em proposta", "negociacao", "em negociacao"],
  won: ["ganho", "ganha", "fechado", "vendido", "convertido", "negocio fechado", "sucesso"],
  lost: ["perdido", "perdida", "descartado", "desistiu", "arquivado", "frio"],
})

export function parseLeadStage(raw: string | null | undefined): ImportLeadStage | null {
  return lookup(LEAD_STAGES, raw)
}

export type ImportLeadSource =
  "portal" | "website" | "social" | "instagram" | "whatsapp" | "referral" | "manual" | "other"

const LEAD_SOURCES = dictionary<ImportLeadSource>({
  portal: [
    "portais",
    "zap",
    "zap imoveis",
    "viva real",
    "vivareal",
    "olx",
    "imovelweb",
    "chaves na mao",
    "quinto andar",
    "canal pro",
    "grupo zap",
  ],
  website: ["site", "site proprio", "pagina", "internet", "google"],
  social: ["redes sociais", "rede social", "facebook", "meta", "tiktok", "youtube", "linkedin"],
  instagram: ["instagram", "insta", "ig", "direct do instagram"],
  whatsapp: ["whatsapp", "whats", "zap zap", "wpp"],
  referral: ["indicacao", "indicado", "indicacao de cliente", "parceiro"],
  manual: [
    "cadastro manual",
    "manual",
    "balcao",
    "plantao",
    "telefone",
    "ligacao",
    "placa",
    "loja",
  ],
  other: ["outro", "outros", "outra"],
})

/** Origem desconhecida vira "Outro" (a origem não impede a importação). */
export function parseLeadSource(raw: string | null | undefined): ImportLeadSource {
  return lookup(LEAD_SOURCES, raw) ?? "other"
}

export type ImportLeadInterest = "buy" | "rent" | "invest" | "sell" | "info"

const LEAD_INTERESTS = dictionary<ImportLeadInterest>({
  buy: ["comprar", "compra", "comprador"],
  rent: ["alugar", "aluguel", "locacao", "locar", "inquilino"],
  invest: ["investir", "investimento", "investidor"],
  sell: ["vender", "venda", "vendedor", "proprietario"],
  info: ["informacoes", "informacao", "duvida", "duvidas", "saber mais"],
})

export function parseLeadInterest(raw: string | null | undefined): ImportLeadInterest | null {
  return lookup(LEAD_INTERESTS, raw)
}

// ---------------------------------------------------------------------------
// Clientes
// ---------------------------------------------------------------------------

const CLIENT_KINDS = dictionary<"pf" | "pj">({
  pf: ["pessoa fisica", "fisica", "f", "cpf", "particular"],
  pj: ["pessoa juridica", "juridica", "j", "cnpj", "empresa"],
})

export function parseClientKind(raw: string | null | undefined): "pf" | "pj" | null {
  return lookup(CLIENT_KINDS, raw)
}

/** Espelho de CLIENT_SOURCE_VALUES (apps/web/lib/clientes/constants.ts). */
export type ImportClientSource =
  "site" | "landing_page" | "portal" | "indicacao" | "placa" | "redes_sociais" | "outro"

const CLIENT_SOURCES = dictionary<ImportClientSource>({
  site: ["website", "site proprio", "internet", "google"],
  landing_page: ["landing page", "landing", "pagina de captura"],
  portal: [
    "portais",
    "zap",
    "zap imoveis",
    "viva real",
    "vivareal",
    "olx",
    "imovelweb",
    "quinto andar",
  ],
  indicacao: ["indicado", "indicacao de cliente", "parceiro"],
  placa: ["placa no imovel", "faixa"],
  redes_sociais: ["redes sociais", "rede social", "instagram", "facebook", "tiktok", "social"],
  outro: ["outros", "outra"],
})

/** Origem conhecida vira a chave da tela de clientes; o resto vira "outro". */
export function parseClientSource(raw: string | null | undefined): ImportClientSource {
  return lookup(CLIENT_SOURCES, raw) ?? "outro"
}

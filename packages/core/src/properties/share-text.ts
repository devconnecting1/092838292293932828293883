/**
 * Texto pronto para compartilhar um imóvel no WhatsApp (link wa.me sem número:
 * quem compartilha escolhe o contato). Módulo puro.
 *
 * Nunca leva rua, número, complemento ou CEP: só bairro e cidade, que aparecem
 * em qualquer modo de exibição do endereço. Nada de dado do proprietário.
 */

import {
  LISTING_PURPOSE_LABELS,
  PROPERTY_TYPE_LABELS,
  type ListingPurpose,
  type PropertyType,
} from "./enums"

export type PropertyShareInput = {
  code: string
  title: string
  type: PropertyType
  purpose: ListingPurpose
  salePrice?: number | null
  rentPrice?: number | null
  condoFee?: number | null
  bedrooms?: number | null
  suites?: number | null
  bathrooms?: number | null
  parkingSpaces?: number | null
  livingArea?: number | null
  lotArea?: number | null
  neighborhood?: string | null
  city?: string | null
  state?: string | null
  /** Assinatura no fim da mensagem (nome da imobiliária). */
  organizationName?: string | null
  /**
   * Página pública do imóvel (só imóvel ativo): fotos, preço e formulário que
   * vira lead, já respeitando o modo de exibição do endereço.
   */
  publicUrl?: string | null
}

const MONEY = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
  maximumFractionDigits: 0,
})

const AREA = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 })

/** Só link http(s) sem espaço: nada de texto solto ou esquema estranho na mensagem. */
function safeUrl(value: string | null | undefined) {
  const url = value?.trim()
  return url && /^https?:\/\/[^\s]+$/i.test(url) && url.length <= 500 ? url : null
}

/** Tira quebras de linha e espaços repetidos (texto digitado pela equipe). */
function clean(value: string | null | undefined, maxLength = 120) {
  return (value ?? "").replace(/\s+/g, " ").trim().slice(0, maxLength)
}

function money(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? MONEY.format(value).replace(/\s/g, " ")
    : null
}

function count(value: number | null | undefined, singular: string, plural: string) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return null
  const amount = Math.trunc(value)
  return `${amount} ${amount === 1 ? singular : plural}`
}

function area(value: number | null | undefined, suffix: string) {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? `${AREA.format(value)} m²${suffix}`
    : null
}

/** "3 quartos (1 suíte) · 2 banheiros · 2 vagas · 120 m²" */
export function describePropertyHighlights(input: PropertyShareInput): string | null {
  const bedrooms = count(input.bedrooms, "quarto", "quartos")
  const suites = count(input.suites, "suíte", "suítes")
  const parts = [
    bedrooms ? (suites ? `${bedrooms} (${suites})` : bedrooms) : suites,
    count(input.bathrooms, "banheiro", "banheiros"),
    count(input.parkingSpaces, "vaga", "vagas"),
    area(input.livingArea, "") ?? area(input.lotArea, " de terreno"),
  ].filter(Boolean)

  return parts.length > 0 ? parts.join(" · ") : null
}

export function buildPropertyShareText(input: PropertyShareInput): string {
  const title = clean(input.title, 160) || PROPERTY_TYPE_LABELS[input.type]
  const code = clean(input.code, 30)
  const sale = input.purpose === "rent" ? null : money(input.salePrice)
  const rent = input.purpose === "sale" ? null : money(input.rentPrice)
  const condo = money(input.condoFee)
  const city = clean(input.city, 80)
  const state = clean(input.state, 2).toUpperCase()
  const place = [clean(input.neighborhood, 80), [city, state].filter(Boolean).join("/")]
    .filter(Boolean)
    .join(", ")
  const highlights = describePropertyHighlights(input)
  const organization = clean(input.organizationName, 80)
  const publicUrl = safeUrl(input.publicUrl)

  const lines = [
    `*${title}*${code ? ` (${code})` : ""}`,
    `${PROPERTY_TYPE_LABELS[input.type]} para ${LISTING_PURPOSE_LABELS[input.purpose].toLowerCase()}`,
    sale ? `Venda: ${sale}` : null,
    rent ? `Locação: ${rent}/mês` : null,
    condo ? `Condomínio: ${condo}/mês` : null,
    highlights,
    place ? `Bairro: ${place}` : null,
    "",
    publicUrl ? `Veja fotos e detalhes: ${publicUrl}` : null,
    "Quer agendar uma visita? Responda esta mensagem.",
    organization ? `_${organization}_` : null,
  ]

  return lines
    .filter((line): line is string => line !== null)
    .join("\n")
    .trim()
}

/** Link wa.me com o texto pronto e sem número de telefone. */
export function buildWhatsappShareUrl(text: string): string {
  return `https://wa.me/?text=${encodeURIComponent(text)}`
}

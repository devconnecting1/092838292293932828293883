// Formatação de exibição das landing pages (pt-BR). Puro e isomórfico.
import {
  LISTING_PURPOSE_LABELS,
  PROPERTY_TYPE_LABELS,
  requiresLotArea,
} from "@workspace/core/properties/enums"

import { formatPhoneDisplay, telUrl } from "@/lib/captacao/masks"
import { formatArea, formatCurrency, formatNumber } from "@/lib/format"
import type { LandingBroker, LandingProperty, LandingTypology } from "@/lib/landing/types"

export function pluralize(count: number, singular: string, plural: string) {
  return `${formatNumber(count)} ${count === 1 ? singular : plural}`
}

export function joinPlace(...parts: (string | null | undefined)[]) {
  const [first, ...rest] = parts.filter((part): part is string => Boolean(part && part.trim()))
  if (!first) return null
  return rest.length === 0 ? first : `${first}, ${rest.join("/")}`
}

/** "Campinas/SP" */
export function cityState(city: string | null | undefined, state: string | null | undefined) {
  return [city, state].filter(Boolean).join("/") || null
}

// ---------------------------------------------------------------------------
// Imóveis
// ---------------------------------------------------------------------------

export type PropertyPrice = {
  label: string
  amount: string
  suffix: string | null
}

/** Preço principal: venda quando houver; aluguel com "/mês". */
export function propertyPrices(property: LandingProperty): PropertyPrice[] {
  const prices: PropertyPrice[] = []
  const sells = property.purpose !== "rent"
  const rents = property.purpose === "rent" || property.purpose === "sale_rent"

  if (sells && property.sale_price != null && property.sale_price > 0) {
    prices.push({
      label: "Venda",
      amount: formatCurrency(property.sale_price),
      suffix: null,
    })
  }
  if (
    (rents || property.purpose == null) &&
    property.rent_price != null &&
    property.rent_price > 0
  ) {
    prices.push({
      label: "Aluguel",
      amount: formatCurrency(property.rent_price),
      suffix: "/mês",
    })
  }
  return prices
}

export function propertyTypeLabel(property: LandingProperty) {
  return property.type ? PROPERTY_TYPE_LABELS[property.type] : "Imóvel"
}

export function propertyPurposeLabel(property: LandingProperty) {
  return property.purpose ? LISTING_PURPOSE_LABELS[property.purpose] : null
}

export function propertyDisplayTitle(property: LandingProperty) {
  if (property.title) return property.title
  const type = propertyTypeLabel(property)
  if (property.neighborhood) return `${type} em ${property.neighborhood}`
  return property.code ? `${type} cód. ${property.code}` : type
}

export function propertyArea(property: LandingProperty) {
  const lotFirst = property.type ? requiresLotArea(property.type) : false
  const area = lotFirst
    ? (property.lot_area ?? property.living_area)
    : (property.living_area ?? property.lot_area)
  return area != null && area > 0 ? formatArea(area) : null
}

export type PropertySpec = {
  key: "bedrooms" | "suites" | "bathrooms" | "parking" | "area"
  value: string
}

export function propertySpecs(property: LandingProperty): PropertySpec[] {
  const specs: PropertySpec[] = []
  const area = propertyArea(property)
  if (area) specs.push({ key: "area", value: area })
  if (property.bedrooms != null && property.bedrooms > 0) {
    specs.push({
      key: "bedrooms",
      value: pluralize(property.bedrooms, "quarto", "quartos"),
    })
  }
  if (property.suites != null && property.suites > 0) {
    specs.push({
      key: "suites",
      value: pluralize(property.suites, "suíte", "suítes"),
    })
  }
  if (property.bathrooms != null && property.bathrooms > 0) {
    specs.push({
      key: "bathrooms",
      value: pluralize(property.bathrooms, "banheiro", "banheiros"),
    })
  }
  if (property.parking_spaces != null && property.parking_spaces > 0) {
    specs.push({
      key: "parking",
      value: pluralize(property.parking_spaces, "vaga", "vagas"),
    })
  }
  return specs
}

// ---------------------------------------------------------------------------
// Lançamentos
// ---------------------------------------------------------------------------

const MONTHS = [
  "janeiro",
  "fevereiro",
  "março",
  "abril",
  "maio",
  "junho",
  "julho",
  "agosto",
  "setembro",
  "outubro",
  "novembro",
  "dezembro",
]

/** "2027-12" / "2027-12-01" → "dezembro de 2027"; texto livre fica como está. */
export function formatDeliveryDate(value: string | null | undefined) {
  if (!value) return null
  const match = /^(\d{4})-(\d{2})(?:-\d{2})?/.exec(value.trim())
  if (!match) return value
  const month = MONTHS[Number(match[2]) - 1]
  return month ? `${month} de ${match[1]}` : value
}

export function formatAreaRange(min?: number, max?: number) {
  if (min != null && max != null && max > min) {
    return `${formatNumber(min)} a ${formatNumber(max)} m²`
  }
  const single = min ?? max
  return single != null ? formatArea(single) : null
}

/** "Restam 12 unidades" / "Resta 1 unidade"; 0 ou vazio não é exibido. */
export function unitsLeftLabel(units: number | null | undefined) {
  if (units == null || units <= 0) return null
  return units === 1 ? "Resta 1 unidade" : `Restam ${formatNumber(units)} unidades`
}

export function typologyBedrooms(typology: LandingTypology) {
  return typology.bedrooms != null && typology.bedrooms > 0
    ? pluralize(typology.bedrooms, "quarto", "quartos")
    : null
}

// ---------------------------------------------------------------------------
// Contato
// ---------------------------------------------------------------------------

function digitsOf(value: string | null | undefined) {
  return (value ?? "").replace(/\D/g, "")
}

/** Celular brasileiro (DDD + 9 + 8 dígitos), com ou sem 55. */
export function isMobilePhoneBr(value: string | null | undefined) {
  let digits = digitsOf(value)
  if (digits.length === 13 && digits.startsWith("55")) digits = digits.slice(2)
  return digits.length === 11 && digits[2] === "9"
}

/**
 * Mensagem do WhatsApp com variáveis: `{codigo}` → código do imóvel em
 * destaque (vazio se não houver) e `{pagina}` → nome da página.
 */
export function fillWhatsappMessage(
  template: string,
  variables: { codigo: string | null; pagina: string }
) {
  return template
    .replace(/\{codigo\}/gi, variables.codigo ?? "")
    .replace(/\{pagina\}/gi, variables.pagina)
    .replace(/\(\s*\)/g, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/ +([.,!?;:])/g, "$1")
    .trim()
}

/** Link wa.me com mensagem pré-preenchida. */
export function whatsappHref(value: string | null | undefined, message?: string) {
  let digits = digitsOf(value)
  if (digits.length === 10 || digits.length === 11) digits = `55${digits}`
  if (!((digits.length === 12 || digits.length === 13) && digits.startsWith("55"))) return null
  const query = message ? `?text=${encodeURIComponent(message)}` : ""
  return `https://wa.me/${digits}${query}`
}

export function phoneHref(value: string | null | undefined) {
  return telUrl(value)
}

export function phoneDisplay(value: string | null | undefined) {
  return formatPhoneDisplay(value)
}

/**
 * Registro profissional da imobiliária nas páginas públicas: "CRECI 12345-J"
 * (aceita valor já prefixado) ou, sem CRECI J, "CRECI 12345-F/SP" do dono —
 * corretor autônomo. Mesmo formato da captação (`publicCreciLabel`).
 */
export function organizationCreciLabel(
  creci: string | null | undefined,
  owner?: { number?: string | null; state?: string | null }
) {
  const agency = creci?.trim()
  if (agency) return /^creci/i.test(agency) ? agency : `CRECI ${agency}`

  const number = owner?.number
    ?.trim()
    .replace(/^creci\s*/i, "")
    .replace(/[\s-]*f$/i, "")
    .trim()
  if (!number) return null

  const state = owner?.state?.trim()
  return state ? `CRECI ${number}-F/${state}` : `CRECI ${number}-F`
}

/** "CRECI/SP 123456-F" */
export function brokerCreciLabel(broker: Pick<LandingBroker, "creci_number" | "creci_state">) {
  if (!broker.creci_number) return null
  return broker.creci_state
    ? `CRECI/${broker.creci_state} ${broker.creci_number}`
    : `CRECI ${broker.creci_number}`
}

export function initialsOf(value: string | null | undefined) {
  const words = (value ?? "").trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return "?"
  const first = words[0]?.charAt(0) ?? ""
  const last = words.length > 1 ? (words[words.length - 1]?.charAt(0) ?? "") : ""
  return `${first}${last}`.toUpperCase()
}

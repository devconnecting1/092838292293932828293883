import type { Tables } from "@workspace/database/types"

import { formatNumber } from "@/lib/format"
import { formatPostalCodeInputValue } from "@/lib/imoveis/number"

type LocationSource = Pick<Tables<"condominiums">, "neighborhood" | "city" | "state">

type AddressSource = LocationSource &
  Pick<Tables<"condominiums">, "street" | "street_number" | "complement" | "postal_code">

function joinFilled(parts: readonly (string | null | undefined)[], separator: string) {
  return parts.filter((part): part is string => Boolean(part)).join(separator)
}

export function formatCityState(city: string | null, state: string | null) {
  if (city && state) return `${city}/${state}`
  return city || state || null
}

/** "Bairro · Cidade/UF"; null quando nada foi informado. */
export function formatCondominiumLocation(row: LocationSource) {
  const text = joinFilled([row.neighborhood, formatCityState(row.city, row.state)], " · ")
  return text.length > 0 ? text : null
}

/** Endereço completo em linhas: rua/número/complemento, bairro/cidade, CEP. */
export function formatCondominiumAddressLines(row: AddressSource) {
  const streetLine = joinFilled([row.street, row.street_number], ", ")
  const lines = [
    joinFilled([streetLine, row.complement], " – "),
    joinFilled([row.neighborhood, formatCityState(row.city, row.state)], " – "),
    row.postal_code ? `CEP ${formatPostalCodeInputValue(row.postal_code)}` : "",
  ]
  return lines.filter((line) => line.length > 0)
}

export function formatPropertiesCount(count: number) {
  return count === 1 ? "1 imóvel" : `${formatNumber(count)} imóveis`
}

export function formatAmenitiesCount(count: number) {
  return count === 1 ? "1 item" : `${formatNumber(count)} itens`
}

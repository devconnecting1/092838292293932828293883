import type { ListingPurpose, PropertyType } from "../properties/enums"

/**
 * Casamento (matching) entre o interesse de um cliente e um imóvel
 * candidato, para ordenar sugestões. Coerente com a view SQL que já filtra
 * os candidatos por finalidade/tipo/preço antes de pontuar — aqui apenas
 * refinamos e explicamos o ranqueamento.
 */

export interface ClientInterest {
  purpose: ListingPurpose
  types?: PropertyType[]
  minPrice?: number
  maxPrice?: number
  minBedrooms?: number
  minParkingSpaces?: number
  neighborhoods?: string[]
  city?: string
}

export interface PropertyForMatch {
  purpose: ListingPurpose
  type: PropertyType
  salePrice?: number
  rentPrice?: number
  bedrooms?: number
  parkingSpaces?: number
  neighborhood?: string
  city?: string
}

export interface MatchResult {
  score: number
  reasons: string[]
}

function isFinitePositiveOrZero(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value)
}

function purposesMatch(interest: ListingPurpose, property: ListingPurpose) {
  return interest === property || interest === "sale_rent" || property === "sale_rent"
}

function priceForInterest(interest: ClientInterest, property: PropertyForMatch) {
  if (interest.purpose === "rent") return property.rentPrice
  if (interest.purpose === "sale") return property.salePrice
  // Interesse em venda ou locação: vale o preço da finalidade que o imóvel oferece.
  return property.purpose === "rent" ? property.rentPrice : property.salePrice
}

// Mesma regra da view SQL (unaccent + lower): "Cambuí" casa com "CAMBUI".
function normalizePlace(value: string | undefined) {
  return (value ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase()
}

export function scoreMatch(interest: ClientInterest, property: PropertyForMatch): MatchResult {
  if (!purposesMatch(interest.purpose, property.purpose)) {
    return {
      score: 0,
      reasons: ["Finalidade do imóvel não corresponde ao interesse do cliente."],
    }
  }

  let score = 30
  const reasons: string[] = ["Finalidade compatível com o interesse do cliente."]

  if (interest.types && interest.types.length > 0) {
    if (interest.types.includes(property.type)) {
      score += 20
      reasons.push("Tipo de imóvel compatível com o interesse do cliente.")
    } else {
      reasons.push("Tipo de imóvel diferente do(s) tipo(s) desejado(s) pelo cliente.")
    }
  } else {
    score += 10
    reasons.push("Cliente não restringiu o tipo de imóvel.")
  }

  const relevantPrice = priceForInterest(interest, property)
  if (isFinitePositiveOrZero(relevantPrice)) {
    const withinMin = interest.minPrice === undefined || relevantPrice >= interest.minPrice
    const withinMax = interest.maxPrice === undefined || relevantPrice <= interest.maxPrice
    if (withinMin && withinMax) {
      score += 25
      reasons.push("Preço dentro da faixa de interesse do cliente.")
    } else {
      reasons.push("Preço fora da faixa de interesse do cliente.")
    }
  }

  if (interest.minBedrooms !== undefined) {
    if (isFinitePositiveOrZero(property.bedrooms) && property.bedrooms >= interest.minBedrooms) {
      score += 10
      reasons.push("Atende ao número mínimo de quartos.")
    } else {
      reasons.push("Não atende ao número mínimo de quartos.")
    }
  }

  if (interest.minParkingSpaces !== undefined) {
    if (
      isFinitePositiveOrZero(property.parkingSpaces) &&
      property.parkingSpaces >= interest.minParkingSpaces
    ) {
      score += 5
      reasons.push("Atende ao número mínimo de vagas de garagem.")
    } else {
      reasons.push("Não atende ao número mínimo de vagas de garagem.")
    }
  }

  if (interest.neighborhoods && interest.neighborhoods.length > 0) {
    const neighborhood = normalizePlace(property.neighborhood)
    if (
      neighborhood &&
      interest.neighborhoods.some((item) => normalizePlace(item) === neighborhood)
    ) {
      score += 10
      reasons.push("Bairro corresponde ao interesse do cliente.")
    } else {
      reasons.push("Bairro fora da lista de interesse do cliente.")
    }
  } else if (
    interest.city &&
    property.city &&
    normalizePlace(interest.city) === normalizePlace(property.city)
  ) {
    score += 5
    reasons.push("Cidade corresponde ao interesse do cliente.")
  }

  return { score: Math.min(100, Math.max(0, Math.round(score))), reasons }
}

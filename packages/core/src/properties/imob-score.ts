import { isValidPostalCode } from "../br/documents"
import { requiredPrices, requiresLotArea, type ListingPurpose, type PropertyType } from "./enums"

/**
 * "ImobScore": pontuação (0-100) da qualidade/completude de um anúncio,
 * inspirada nos scores de qualidade de anúncio dos grandes portais
 * imobiliários. Função pura — nenhuma dependência externa.
 */

/** Tipos de imóvel que, em geral, não têm taxa de condomínio (casa isolada, terreno, etc.). */
const NO_CONDO_TYPES: ReadonlySet<PropertyType> = new Set([
  "house",
  "land",
  "farm",
  "ranch",
  "warehouse",
])

export interface ImobScorePrices {
  salePrice?: number
  rentPrice?: number
  condoFee?: number
  iptuYearly?: number
}

export interface ImobScoreAddress {
  postalCode?: string
  latitude?: number
  longitude?: number
}

export interface ImobScoreInput {
  purpose: ListingPurpose
  type: PropertyType
  photosCount: number
  description?: string
  prices?: ImobScorePrices
  livingArea?: number
  lotArea?: number
  bedrooms?: number
  bathrooms?: number
  address?: ImobScoreAddress
  videoUrl?: string
  tourUrl?: string
  /** Data de validade da autorização de venda/locação vigente. */
  saleAuthorizationExpiresAt?: Date | string
}

export interface ImobScoreItem {
  key: string
  label: string
  points: number
  max: number
  done: boolean
  hint: string
}

export interface ImobScoreResult {
  score: number
  items: ImobScoreItem[]
}

function normalizedDescriptionLength(description: string | undefined): number {
  if (!description) return 0
  return description.trim().replace(/\s+/g, " ").length
}

function isPositiveNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
}

function scorePhotos(count: number): number {
  if (count >= 15) return 30
  if (count >= 5) return 20
  if (count <= 0) return 0
  return Math.round((count / 4) * 10)
}

function scoreDescription(description: string | undefined): number {
  const length = normalizedDescriptionLength(description)
  if (length >= 300) return 15
  if (length >= 50) return 7
  return 0
}

function scorePrices(
  purpose: ListingPurpose,
  type: PropertyType,
  prices: ImobScorePrices | undefined
): number {
  const required = requiredPrices(purpose)
  const hasRequiredPrices = required.every((field) => isPositiveNumber(prices?.[field]))

  let points = hasRequiredPrices ? 9 : 0

  const condoSatisfied = NO_CONDO_TYPES.has(type) || isPositiveNumber(prices?.condoFee)
  if (condoSatisfied) points += 3

  if (isPositiveNumber(prices?.iptuYearly)) points += 3

  return points
}

function scoreAreasAndRooms(
  type: PropertyType,
  livingArea: number | undefined,
  lotArea: number | undefined,
  bedrooms: number | undefined,
  bathrooms: number | undefined
): number {
  const lotOnly = requiresLotArea(type)
  const relevantArea = lotOnly ? lotArea : livingArea
  const areaPoints = isPositiveNumber(relevantArea) ? 6 : 0

  // Para land/warehouse/farm/ranch apenas a área é considerada: os 4 pontos
  // de quartos/banheiros não se aplicam e são concedidos automaticamente.
  const roomsPoints = lotOnly || (isPositiveNumber(bedrooms) && isPositiveNumber(bathrooms)) ? 4 : 0

  return areaPoints + roomsPoints
}

function scoreAddress(address: ImobScoreAddress | undefined): number {
  const cepPoints =
    address?.postalCode !== undefined && isValidPostalCode(address.postalCode) ? 5 : 0
  const coordsPoints =
    Number.isFinite(address?.latitude) && Number.isFinite(address?.longitude) ? 5 : 0
  return cepPoints + coordsPoints
}

function scoreMedia(videoUrl: string | undefined, tourUrl: string | undefined): number {
  return videoUrl || tourUrl ? 10 : 0
}

function scoreAuthorization(expiresAt: Date | string | undefined, now: Date): number {
  if (!expiresAt) return 0
  const expiresDate = expiresAt instanceof Date ? expiresAt : new Date(expiresAt)
  if (Number.isNaN(expiresDate.getTime())) return 0
  return expiresDate.getTime() >= now.getTime() ? 10 : 0
}

export function computeImobScore(input: ImobScoreInput, now: Date = new Date()): ImobScoreResult {
  const photosPoints = scorePhotos(input.photosCount)
  const descriptionPoints = scoreDescription(input.description)
  const pricesPoints = scorePrices(input.purpose, input.type, input.prices)
  const areasPoints = scoreAreasAndRooms(
    input.type,
    input.livingArea,
    input.lotArea,
    input.bedrooms,
    input.bathrooms
  )
  const addressPoints = scoreAddress(input.address)
  const mediaPoints = scoreMedia(input.videoUrl, input.tourUrl)
  const authorizationPoints = scoreAuthorization(input.saleAuthorizationExpiresAt, now)

  const items: ImobScoreItem[] = [
    {
      key: "photos",
      label: "Fotos",
      points: photosPoints,
      max: 30,
      done: photosPoints === 30,
      hint: "Portais exigem no mínimo 5 fotos; anúncios com 15 ou mais fotos pontuam o máximo.",
    },
    {
      key: "description",
      label: "Descrição",
      points: descriptionPoints,
      max: 15,
      done: descriptionPoints === 15,
      hint: "Escreva uma descrição com pelo menos 300 caracteres para valorizar o imóvel.",
    },
    {
      key: "prices",
      label: "Preços",
      points: pricesPoints,
      max: 15,
      done: pricesPoints === 15,
      hint: "Informe o(s) preço(s) exigido(s) pela finalidade do anúncio, o condomínio e o IPTU.",
    },
    {
      key: "areas",
      label: "Áreas e cômodos",
      points: areasPoints,
      max: 10,
      done: areasPoints === 10,
      hint: "Informe a área exigida para o tipo de imóvel e, quando aplicável, quartos e banheiros.",
    },
    {
      key: "address",
      label: "Endereço",
      points: addressPoints,
      max: 10,
      done: addressPoints === 10,
      hint: "Informe um CEP válido e as coordenadas (latitude/longitude) do imóvel.",
    },
    {
      key: "media",
      label: "Vídeo ou tour virtual",
      points: mediaPoints,
      max: 10,
      done: mediaPoints === 10,
      hint: "Adicione um vídeo ou tour virtual para aumentar o engajamento do anúncio.",
    },
    {
      key: "authorization",
      label: "Autorização de venda",
      points: authorizationPoints,
      max: 10,
      done: authorizationPoints === 10,
      hint: "Mantenha a autorização de venda/locação vigente na data de hoje.",
    },
  ]

  const score = items.reduce((sum, item) => sum + item.points, 0)

  return { score, items }
}

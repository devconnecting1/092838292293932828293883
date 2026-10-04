import type { Tables } from "@workspace/database/types"

import type { Role } from "@/lib/auth/roles"
import type { MediaSummary } from "@/lib/imoveis/mappers"
import {
  formatBrlInputValue,
  formatCoordinateInputValue,
  formatDecimalInputValue,
  formatIntegerInputValue,
  formatPostalCodeInputValue,
} from "@/lib/imoveis/number"
import type { PropertyFormValues } from "@/lib/imoveis/schema"

export type CaptureRequestPrefill = Pick<
  Tables<"capture_requests">,
  | "id"
  | "owner_name"
  | "owner_email"
  | "owner_phone"
  | "purpose"
  | "type"
  | "postal_code"
  | "neighborhood"
  | "city"
  | "state"
  | "expected_price"
  | "message"
  | "status"
  | "converted_property_id"
>

export function emptyPropertyFormValues(role: Role, userId: string): PropertyFormValues {
  return {
    title: "",
    description: "",
    purpose: "sale",
    usage: "residential",
    type: "apartment",
    condominiumId: "",
    capturedBy: role === "capturer" ? userId : "",
    brokerId: role === "broker" ? userId : "",
    externalCode: "",
    registryNumber: "",
    salePrice: "",
    rentPrice: "",
    condoFee: "",
    iptuYearly: "",
    postalCode: "",
    street: "",
    streetNumber: "",
    complement: "",
    neighborhood: "",
    city: "",
    state: "",
    latitude: "",
    longitude: "",
    addressDisplay: "neighborhood",
    livingArea: "",
    lotArea: "",
    bedrooms: "",
    suites: "",
    bathrooms: "",
    parkingSpaces: "",
    floor: "",
    totalFloors: "",
    yearBuilt: "",
    furnished: false,
    acceptsPets: false,
    acceptsExchange: false,
    features: [],
    videoUrl: "",
    tourUrl: "",
    status: "draft",
    publishedToPortals: false,
    isRestricted: false,
  }
}

/** Pré-preenchimento a partir de uma captação (formulário público). */
export function captureToFormValues(
  base: PropertyFormValues,
  capture: CaptureRequestPrefill
): PropertyFormValues {
  const price = formatBrlInputValue(capture.expected_price)
  const type = capture.type ?? base.type

  return {
    ...base,
    purpose: capture.purpose,
    type,
    usage: type === "farm" || type === "ranch" ? "rural" : base.usage,
    salePrice: capture.purpose !== "rent" ? price : "",
    rentPrice: capture.purpose === "rent" ? price : "",
    postalCode: formatPostalCodeInputValue(capture.postal_code),
    neighborhood: capture.neighborhood ?? "",
    city: capture.city ?? "",
    state: capture.state ?? "",
    description: capture.message ? `Mensagem do proprietário na captação:\n${capture.message}` : "",
  }
}

export function propertyRowToFormValues(
  property: Tables<"properties">,
  media: MediaSummary
): PropertyFormValues {
  return {
    title: property.title,
    description: property.description ?? "",
    purpose: property.purpose,
    usage: property.usage,
    type: property.type,
    condominiumId: property.condominium_id ?? "",
    capturedBy: property.captured_by ?? "",
    brokerId: property.broker_id ?? "",
    externalCode: property.external_code ?? "",
    registryNumber: property.registry_number ?? "",
    salePrice: formatBrlInputValue(property.sale_price),
    rentPrice: formatBrlInputValue(property.rent_price),
    condoFee: formatBrlInputValue(property.condo_fee),
    iptuYearly: formatBrlInputValue(property.iptu_yearly),
    postalCode: formatPostalCodeInputValue(property.postal_code),
    street: property.street ?? "",
    streetNumber: property.street_number ?? "",
    complement: property.complement ?? "",
    neighborhood: property.neighborhood ?? "",
    city: property.city ?? "",
    state: property.state ?? "",
    latitude: formatCoordinateInputValue(property.latitude),
    longitude: formatCoordinateInputValue(property.longitude),
    addressDisplay: property.address_display,
    livingArea: formatDecimalInputValue(property.living_area),
    lotArea: formatDecimalInputValue(property.lot_area),
    bedrooms: formatIntegerInputValue(property.bedrooms),
    suites: formatIntegerInputValue(property.suites),
    bathrooms: formatIntegerInputValue(property.bathrooms),
    parkingSpaces: formatIntegerInputValue(property.parking_spaces),
    floor: formatIntegerInputValue(property.floor),
    totalFloors: formatIntegerInputValue(property.total_floors),
    yearBuilt: formatIntegerInputValue(property.year_built),
    furnished: property.furnished,
    acceptsPets: property.accepts_pets,
    acceptsExchange: property.accepts_exchange,
    features: property.features,
    videoUrl: media.videoUrl ?? "",
    tourUrl: media.tourUrl ?? "",
    status: property.status,
    publishedToPortals: property.published_to_portals,
    isRestricted: property.is_restricted,
  }
}

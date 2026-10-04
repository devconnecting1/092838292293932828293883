import "server-only"

// Ficha do imóvel para imprimir ou enviar (PDF): leitura dos dados com a sessão
// de quem pediu. O RLS decide o acesso — imóvel que a pessoa não vê volta null
// e a rota responde 404. Nada do proprietário entra na ficha.

import {
  ADDRESS_DISPLAY_LABELS,
  LISTING_PURPOSE_LABELS,
  PROPERTY_TYPE_LABELS,
  PROPERTY_USAGE_LABELS,
  type AddressDisplay,
  type ListingPurpose,
} from "@workspace/core/properties/enums"
import { formatPhoneBr, isValidPhoneBr } from "@workspace/core/br/documents"

import { readOrganizationBrand, type OrganizationBrand } from "@/lib/configuracoes/brand"
import { getAmenityLabel } from "@/lib/imoveis/amenities"
import { summarizeMedia } from "@/lib/imoveis/mappers"
import { getPropertyMediaPublicUrl } from "@/lib/imoveis/media-url"
import {
  getPropertyMediaRows,
  getPropertyRow,
  type ServerSupabaseClient,
} from "@/lib/imoveis/queries"

/** Capa + 3 fotos: cabe na primeira página sem pesar no WhatsApp. */
export const PROPERTY_SHEET_MAX_PHOTOS = 4

const PHOTO_MAX_BYTES = 4_000_000
const PHOTO_TIMEOUT_MS = 6_000

export type PropertySheetPhoto = { bytes: Uint8Array; kind: "jpeg" | "png" }

export type PropertySheetDocument = {
  property: {
    id: string
    code: string
    title: string
    typeLabel: string
    usageLabel: string
    purpose: ListingPurpose
    purposeLabel: string
    salePrice: number | null
    rentPrice: number | null
    condoFee: number | null
    iptuYearly: number | null
    livingArea: number | null
    lotArea: number | null
    bedrooms: number | null
    suites: number | null
    bathrooms: number | null
    parkingSpaces: number | null
    floor: number | null
    totalFloors: number | null
    yearBuilt: number | null
    furnished: boolean
    acceptsPets: boolean
    acceptsExchange: boolean
    amenities: string[]
    description: string | null
    /** Endereço já recortado pelo modo de exibição do imóvel. */
    address: string | null
    addressDisplay: AddressDisplay
    condominiumName: string | null
  }
  organization: {
    name: string
    legalName: string | null
    cnpj: string | null
    creci: string | null
    phone: string | null
    email: string | null
    city: string | null
    state: string | null
    brand: OrganizationBrand
  }
  /** Quem gerou a ficha: é o contato para quem recebe. */
  agent: {
    name: string | null
    creci: string | null
    phone: string | null
    email: string | null
  } | null
  /** Caminhos das fotos (capa primeiro) no bucket property-media. */
  photoPaths: string[]
  generatedAt: string
}

function text(value: string | null | undefined) {
  const trimmed = value?.replace(/\s+/g, " ").trim()
  return trimmed ? trimmed : null
}

function toNumber(value: number | string | null | undefined) {
  if (value == null) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function formatPhone(value: string | null | undefined) {
  const phone = text(value)
  return phone && isValidPhoneBr(phone) ? formatPhoneBr(phone) : phone
}

/**
 * Endereço conforme o modo de exibição: completo (rua e número), só rua, ou só
 * bairro e cidade. Complemento e CEP nunca saem na ficha.
 */
export function formatSheetAddress(property: {
  address_display: AddressDisplay
  street: string | null
  street_number: string | null
  neighborhood: string | null
  city: string | null
  state: string | null
}) {
  const street =
    property.address_display === "full"
      ? [text(property.street), text(property.street_number)].filter(Boolean).join(", ")
      : property.address_display === "street"
        ? text(property.street)
        : null
  const place = [
    text(property.neighborhood),
    [text(property.city), text(property.state)?.toUpperCase()].filter(Boolean).join("/"),
  ]
    .filter(Boolean)
    .join(", ")

  return [street, place].filter(Boolean).join(" — ") || null
}

function formatCreci(number: string | null, state: string | null) {
  const value = text(number)
  if (!value) return null
  const suffix = text(state) ? `/${text(state)?.toUpperCase()}` : ""
  return /^creci/i.test(value) ? `${value}${suffix}` : `CRECI ${value}${suffix}`
}

export async function getPropertySheetDocument(
  supabase: ServerSupabaseClient,
  organizationId: string,
  propertyId: string,
  userId: string
): Promise<PropertySheetDocument | null> {
  const property = await getPropertyRow(supabase, organizationId, propertyId)

  if (!property) {
    return null
  }

  const [media, organizationResult, profileResult, condominiumResult] = await Promise.all([
    getPropertyMediaRows(supabase, organizationId, property.id),
    supabase
      .from("organizations")
      .select("name, legal_name, cnpj, creci, phone, email, city, state, brand")
      .eq("id", organizationId)
      .maybeSingle(),
    supabase
      .from("profiles")
      .select("full_name, phone, email, creci_number, creci_state")
      .eq("id", userId)
      .maybeSingle(),
    property.condominium_id
      ? supabase
          .from("condominiums")
          .select("name")
          .eq("organization_id", organizationId)
          .eq("id", property.condominium_id)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ])

  const organization = organizationResult.data

  if (organizationResult.error || !organization) {
    throw new Error(
      `Não foi possível carregar a imobiliária (${organizationResult.error?.code ?? "erro"}).`
    )
  }

  const images = summarizeMedia(media).images
  const cover = images.find((image) => image.is_cover) ?? images[0]
  const photoPaths = [cover, ...images.filter((image) => image !== cover)]
    .map((image) => image?.storage_path)
    .filter((path): path is string => Boolean(path))
    .slice(0, PROPERTY_SHEET_MAX_PHOTOS)

  const profile = profileResult.data

  return {
    property: {
      id: property.id,
      code: property.code,
      title: text(property.title) ?? PROPERTY_TYPE_LABELS[property.type],
      typeLabel: PROPERTY_TYPE_LABELS[property.type],
      usageLabel: PROPERTY_USAGE_LABELS[property.usage],
      purpose: property.purpose,
      purposeLabel: LISTING_PURPOSE_LABELS[property.purpose],
      salePrice: property.purpose === "rent" ? null : toNumber(property.sale_price),
      rentPrice: property.purpose === "sale" ? null : toNumber(property.rent_price),
      condoFee: toNumber(property.condo_fee),
      iptuYearly: toNumber(property.iptu_yearly),
      livingArea: toNumber(property.living_area),
      lotArea: toNumber(property.lot_area),
      bedrooms: property.bedrooms,
      suites: property.suites,
      bathrooms: property.bathrooms,
      parkingSpaces: property.parking_spaces,
      floor: property.floor,
      totalFloors: property.total_floors,
      yearBuilt: property.year_built,
      furnished: property.furnished,
      acceptsPets: property.accepts_pets,
      acceptsExchange: property.accepts_exchange,
      amenities: property.features.map(getAmenityLabel).filter(Boolean),
      description: property.description?.trim() || null,
      address: formatSheetAddress(property),
      addressDisplay: property.address_display,
      condominiumName: text(condominiumResult.data?.name),
    },
    organization: {
      name: organization.name,
      legalName: text(organization.legal_name),
      cnpj: text(organization.cnpj),
      creci: text(organization.creci),
      phone: formatPhone(organization.phone),
      email: text(organization.email),
      city: text(organization.city),
      state: text(organization.state),
      brand: readOrganizationBrand(organization.brand),
    },
    agent: profile
      ? {
          name: text(profile.full_name),
          creci: formatCreci(profile.creci_number, profile.creci_state),
          phone: formatPhone(profile.phone),
          email: text(profile.email),
        }
      : null,
    photoPaths,
    generatedAt: new Date().toISOString(),
  }
}

/** Rótulo do modo de exibição, para explicar por que o endereço está incompleto. */
export function addressDisplayNote(display: AddressDisplay) {
  return display === "full"
    ? null
    : `${ADDRESS_DISPLAY_LABELS[display]}: o endereço exato é informado no agendamento da visita.`
}

function detectPhotoKind(bytes: Uint8Array): PropertySheetPhoto["kind"] | null {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpeg"
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "png"
  return null
}

async function fetchPhoto(storagePath: string): Promise<PropertySheetPhoto | null> {
  // URL montada a partir do Supabase do próprio projeto (nunca de dado digitado).
  const url = getPropertyMediaPublicUrl(storagePath)

  if (!url) {
    return null
  }

  try {
    const response = await fetch(url, {
      redirect: "error",
      signal: AbortSignal.timeout(PHOTO_TIMEOUT_MS),
      headers: { Accept: "image/jpeg,image/png" },
    })

    if (!response.ok) {
      return null
    }

    const length = Number(response.headers.get("content-length"))

    if (Number.isFinite(length) && length > PHOTO_MAX_BYTES) {
      return null
    }

    const bytes = new Uint8Array(await response.arrayBuffer())

    if (bytes.byteLength === 0 || bytes.byteLength > PHOTO_MAX_BYTES) {
      return null
    }

    // WebP e outros formatos não entram no PDF (pdf-lib só embute JPEG e PNG).
    const kind = detectPhotoKind(bytes)
    return kind ? { bytes, kind } : null
  } catch {
    return null
  }
}

/** Baixa as fotos em paralelo; foto que falha só some da ficha. */
export async function fetchPropertySheetPhotos(
  paths: readonly string[]
): Promise<PropertySheetPhoto[]> {
  const photos = await Promise.all(paths.map((path) => fetchPhoto(path)))
  return photos.filter((photo): photo is PropertySheetPhoto => photo !== null)
}

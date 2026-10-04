/**
 * Dados estruturados schema.org da landing page (puro, isomórfico).
 *
 * - `RealEstateAgent` para a imobiliária, com o CRECI em `identifier` e o
 *   corretor responsável (quando houver) em `employee`.
 * - `RealEstateListing` para cada imóvel exibido pelo modelo (mesmo corte de
 *   `maxProperties`), com `Offer` em BRL (venda e/ou locação) e endereço só
 *   até bairro/cidade/UF — nunca rua ou número.
 * - Nos lançamentos com nome, um `RealEstateListing` do empreendimento com
 *   `AggregateOffer` a partir dos preços iniciais das tipologias.
 *
 * O L3 injeta cada item num <script type="application/ld+json"> usando
 * `serializeJsonLd(item)` como conteúdo (escapa `<`, `>`, `&` e os
 * separadores de linha Unicode para não fechar a tag script).
 */
import { requiresLotArea, type PropertyType } from "@workspace/core/properties/enums"

import { propertyDisplayTitle } from "@/lib/landing/format"
import { getLandingTemplate } from "@/lib/landing/templates"
import { buildPublicStorageUrl, getStorageBaseUrl } from "@/lib/landing/theme"
import {
  LANDING_ASSETS_BUCKET,
  LANDING_PROPERTY_MEDIA_BUCKET,
  isHttpsUrl,
  type LandingProperty,
  type LandingPublicPayload,
} from "@/lib/landing/types"

export type JsonLdObject = Record<string, unknown>

export type BuildLandingJsonLdOptions = {
  /** URL canônica da página pública (http/https). Sem ela, os itens saem sem `url`/`@id`. */
  pageUrl?: string | null
  /** Base do Supabase; padrão `NEXT_PUBLIC_SUPABASE_URL`. */
  storageBaseUrl?: string | null
}

const SELL = "http://purl.org/goodrelations/v1#Sell"
const LEASE_OUT = "http://purl.org/goodrelations/v1#LeaseOut"

/** Remove chaves undefined/null, strings vazias e listas vazias (raso). */
function compact(object: JsonLdObject): JsonLdObject {
  return Object.fromEntries(
    Object.entries(object).filter(([, value]) => {
      if (value === undefined || value === null || value === "") return false
      if (Array.isArray(value) && value.length === 0) return false
      return true
    })
  )
}

function postalAddress(city: string | null, state: string | null) {
  if (!city && !state) return undefined
  return compact({
    "@type": "PostalAddress",
    addressLocality: city,
    addressRegion: state,
    addressCountry: "BR",
  })
}

const RESIDENCE_TYPES: Partial<Record<PropertyType, string>> = {
  apartment: "Apartment",
  penthouse: "Apartment",
  studio: "Apartment",
  flat: "Apartment",
  house: "SingleFamilyResidence",
  condo_house: "SingleFamilyResidence",
}

function positive(value: number | null) {
  return value != null && value > 0 ? value : undefined
}

function propertyEntity(property: LandingProperty) {
  const residenceType = property.type ? RESIDENCE_TYPES[property.type] : undefined
  const lotFirst = property.type ? requiresLotArea(property.type) : false
  const area = positive(lotFirst ? property.lot_area : property.living_area)

  const base = {
    name: propertyDisplayTitle(property),
    address: postalAddress(property.city, property.state),
    containedInPlace: property.neighborhood
      ? { "@type": "Place", name: property.neighborhood }
      : undefined,
  }

  if (residenceType) {
    return compact({
      "@type": residenceType,
      ...base,
      numberOfBedrooms: positive(property.bedrooms),
      numberOfBathroomsTotal: positive(property.bathrooms),
      floorSize: area ? { "@type": "QuantitativeValue", value: area, unitCode: "MTK" } : undefined,
      amenityFeature: property.features.slice(0, 20).map((feature) => ({
        "@type": "LocationFeatureSpecification",
        name: feature,
        value: true,
      })),
    })
  }

  // Terrenos, rurais e comerciais: `Place` (sem contagem de quartos).
  return compact({
    "@type": "Place",
    ...base,
    additionalProperty: area
      ? {
          "@type": "PropertyValue",
          name: lotFirst ? "Área do terreno" : "Área construída",
          value: area,
          unitCode: "MTK",
        }
      : undefined,
  })
}

function safePageUrl(value: string | null | undefined) {
  if (!value) return undefined
  try {
    const url = new URL(value)
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : undefined
  } catch {
    return undefined
  }
}

export function buildLandingJsonLd(
  payload: LandingPublicPayload,
  options: BuildLandingJsonLdOptions = {}
): JsonLdObject[] {
  const { page, organization, broker } = payload
  const template = getLandingTemplate(page.template)
  const baseUrl =
    options.storageBaseUrl === undefined ? getStorageBaseUrl() : options.storageBaseUrl
  const pageUrl = safePageUrl(options.pageUrl)
  const agencyId = pageUrl ? `${pageUrl}#imobiliaria` : undefined

  const logo =
    buildPublicStorageUrl(baseUrl, LANDING_ASSETS_BUCKET, page.theme.logo_path) ??
    (isHttpsUrl(organization.brand.logo_url) ? organization.brand.logo_url : undefined)

  const agent = compact({
    "@context": "https://schema.org",
    "@type": "RealEstateAgent",
    "@id": agencyId,
    name: organization.name,
    url: pageUrl,
    logo,
    image: logo,
    telephone: organization.phone,
    email: organization.email,
    address: postalAddress(organization.city, organization.state),
    identifier: organization.creci
      ? {
          "@type": "PropertyValue",
          propertyID: "CRECI",
          value: organization.creci,
        }
      : undefined,
    employee: broker
      ? compact({
          "@type": "Person",
          name: broker.full_name,
          jobTitle: "Corretor de imóveis",
          identifier: broker.creci_number
            ? {
                "@type": "PropertyValue",
                propertyID: "CRECI",
                value: broker.creci_state
                  ? `${broker.creci_number}/${broker.creci_state}`
                  : broker.creci_number,
              }
            : undefined,
        })
      : undefined,
  })

  const seller = agencyId
    ? { "@id": agencyId }
    : { "@type": "RealEstateAgent", name: organization.name }
  const items: JsonLdObject[] = [agent]

  if (template.usesProperties !== "none") {
    for (const property of payload.properties.slice(0, template.maxProperties)) {
      const images = [property.cover_path, ...property.media_paths]
        .map((path) => buildPublicStorageUrl(baseUrl, LANDING_PROPERTY_MEDIA_BUCKET, path))
        .filter((url, index, all): url is string => url !== null && all.indexOf(url) === index)
        .slice(0, 10)

      const offers: JsonLdObject[] = []
      const sells = property.purpose !== "rent"
      const rents = property.purpose === "rent" || property.purpose === "sale_rent"
      if (sells && positive(property.sale_price)) {
        offers.push({
          "@type": "Offer",
          businessFunction: SELL,
          price: property.sale_price,
          priceCurrency: "BRL",
          availability: "https://schema.org/InStock",
          seller,
        })
      }
      if ((rents || property.purpose == null) && positive(property.rent_price)) {
        offers.push({
          "@type": "Offer",
          businessFunction: LEASE_OUT,
          price: property.rent_price,
          priceCurrency: "BRL",
          priceSpecification: {
            "@type": "UnitPriceSpecification",
            price: property.rent_price,
            priceCurrency: "BRL",
            unitCode: "MON",
          },
          availability: "https://schema.org/InStock",
          seller,
        })
      }

      items.push(
        compact({
          "@context": "https://schema.org",
          "@type": "RealEstateListing",
          name: propertyDisplayTitle(property),
          url: pageUrl,
          datePosted: page.published_at,
          image: images,
          identifier: property.code ?? undefined,
          mainEntity: propertyEntity(property),
          offers,
        })
      )
    }
  }

  const launch = page.content.launch
  if (template.category === "lancamentos" && launch?.name) {
    const prices = (launch.typologies ?? [])
      .map((typology) => typology.price_from)
      .filter((price): price is number => price != null && price > 0)
    const images = [page.theme.background_image_path, ...(page.theme.banner_image_paths ?? [])]
      .map((path) => buildPublicStorageUrl(baseUrl, LANDING_ASSETS_BUCKET, path))
      .filter((url): url is string => url !== null)
      .slice(0, 10)

    items.push(
      compact({
        "@context": "https://schema.org",
        "@type": "RealEstateListing",
        name: launch.name,
        description: page.content.subheadline ?? page.content.description,
        url: pageUrl,
        datePosted: page.published_at,
        image: images,
        mainEntity: compact({
          "@type": "ApartmentComplex",
          name: launch.name,
          address: postalAddress(launch.city ?? null, launch.state ?? null),
          containedInPlace: launch.neighborhood
            ? { "@type": "Place", name: launch.neighborhood }
            : undefined,
        }),
        offers:
          prices.length > 0
            ? {
                "@type": "AggregateOffer",
                businessFunction: SELL,
                lowPrice: Math.min(...prices),
                highPrice: Math.max(...prices),
                priceCurrency: "BRL",
                offerCount: prices.length,
                seller,
              }
            : undefined,
      })
    )
  }

  return items
}

// Separadores de linha Unicode montados por código (sem caractere literal no fonte).
const LINE_SEPARATOR = new RegExp(String.fromCharCode(0x2028), "g")
const PARAGRAPH_SEPARATOR = new RegExp(String.fromCharCode(0x2029), "g")

/** JSON seguro para o conteúdo de `<script type="application/ld+json">`. */
export function serializeJsonLd(data: unknown) {
  return JSON.stringify(data)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(LINE_SEPARATOR, "\\u2028")
    .replace(PARAGRAPH_SEPARATOR, "\\u2029")
}

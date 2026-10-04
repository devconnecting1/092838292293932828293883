/**
 * Dados estruturados schema.org da página pública do imóvel (puro).
 *
 * - `RealEstateListing` (https://schema.org/RealEstateListing, subtipo de
 *   WebPage): a página do anúncio, com `datePosted`, fotos, `offers` (venda
 *   e/ou locação em BRL) e o imóvel em `mainEntity`.
 * - `mainEntity`: `Apartment`/`SingleFamilyResidence` (subtipos de
 *   Accommodation, com quartos, banheiros, área e pets) para residenciais;
 *   `Place` com área nos demais (terreno, sala, galpão…).
 * - `RealEstateAgent` para a imobiliária, com o CRECI em `identifier`.
 *
 * O endereço segue o modo de exibição: rua e número só quando permitidos.
 */
import { requiresLotArea, type PropertyType } from "@workspace/core/properties/enums"

import type { PublicPropertyPayload } from "@/lib/imovel-publico/types"
import { publicPropertyPlace, type PublicPropertyView } from "@/lib/imovel-publico/view-model"

type JsonLdObject = Record<string, unknown>

const SELL = "http://purl.org/goodrelations/v1#Sell"
const LEASE_OUT = "http://purl.org/goodrelations/v1#LeaseOut"

const RESIDENCE_TYPES: Partial<Record<PropertyType, string>> = {
  apartment: "Apartment",
  penthouse: "Apartment",
  studio: "Apartment",
  flat: "Apartment",
  house: "SingleFamilyResidence",
  condo_house: "SingleFamilyResidence",
}

/** Remove chaves vazias (undefined, null, "" e listas vazias). */
function compact(object: JsonLdObject): JsonLdObject {
  return Object.fromEntries(
    Object.entries(object).filter(([, value]) => {
      if (value === undefined || value === null || value === "") return false
      return !(Array.isArray(value) && value.length === 0)
    })
  )
}

function positive(value: number | null) {
  return value != null && value > 0 ? value : undefined
}

export function buildPublicPropertyJsonLd(
  payload: PublicPropertyPayload,
  view: PublicPropertyView,
  pageUrl: string | null
): JsonLdObject[] {
  const { property, organization } = payload
  const agencyId = pageUrl ? `${pageUrl}#imobiliaria` : undefined

  const street =
    property.addressDisplay === "neighborhood"
      ? undefined
      : [property.street, property.addressDisplay === "full" ? property.streetNumber : null]
          .filter(Boolean)
          .join(", ") || undefined

  const address = compact({
    "@type": "PostalAddress",
    streetAddress: street,
    addressLocality: property.city,
    addressRegion: property.state,
    addressCountry: "BR",
  })

  const residenceType = property.type ? RESIDENCE_TYPES[property.type] : undefined
  const lotFirst = property.type ? requiresLotArea(property.type) : false
  const area = positive(lotFirst ? property.lotArea : (property.livingArea ?? property.lotArea))
  const floorSize = area
    ? { "@type": "QuantitativeValue", value: area, unitCode: "MTK" }
    : undefined

  const place = {
    name: view.title,
    address,
    containedInPlace: property.neighborhood
      ? { "@type": "Place", name: property.neighborhood }
      : undefined,
  }

  const mainEntity = residenceType
    ? compact({
        "@type": residenceType,
        ...place,
        numberOfBedrooms: positive(property.bedrooms),
        numberOfBathroomsTotal: positive(property.bathrooms),
        floorSize,
        petsAllowed: property.acceptsPets || undefined,
        yearBuilt: positive(property.yearBuilt),
        amenityFeature: property.features.slice(0, 20).map((feature) => ({
          "@type": "LocationFeatureSpecification",
          name: feature,
          value: true,
        })),
      })
    : compact({
        "@type": "Place",
        ...place,
        additionalProperty: area
          ? {
              "@type": "PropertyValue",
              name: lotFirst ? "Área do terreno" : "Área construída",
              value: area,
              unitCode: "MTK",
            }
          : undefined,
      })

  const seller = agencyId
    ? { "@id": agencyId }
    : { "@type": "RealEstateAgent", name: organization.name }
  const offers: JsonLdObject[] = []
  const sells = property.purpose !== "rent"
  const rents = property.purpose === "rent" || property.purpose === "sale_rent"

  if (sells && positive(property.salePrice)) {
    offers.push({
      "@type": "Offer",
      businessFunction: SELL,
      price: property.salePrice,
      priceCurrency: "BRL",
      availability: "https://schema.org/InStock",
      seller,
    })
  }

  if ((rents || property.purpose == null) && positive(property.rentPrice)) {
    offers.push({
      "@type": "Offer",
      businessFunction: LEASE_OUT,
      price: property.rentPrice,
      priceCurrency: "BRL",
      priceSpecification: {
        "@type": "UnitPriceSpecification",
        price: property.rentPrice,
        priceCurrency: "BRL",
        unitCode: "MON",
      },
      availability: "https://schema.org/InStock",
      seller,
    })
  }

  const listing = compact({
    "@context": "https://schema.org",
    "@type": "RealEstateListing",
    "@id": pageUrl ? `${pageUrl}#anuncio` : undefined,
    url: pageUrl,
    name: view.title,
    description: property.description
      ? Array.from(property.description).slice(0, 500).join("")
      : publicPropertyPlace(property),
    inLanguage: "pt-BR",
    datePosted: property.listedAt,
    dateModified: property.updatedAt,
    identifier: property.code,
    image: view.photos.slice(0, 10).map((photo) => photo.src),
    offers,
    mainEntity,
  })

  const agent = compact({
    "@context": "https://schema.org",
    "@type": "RealEstateAgent",
    "@id": agencyId,
    name: organization.name,
    logo: view.organization.logoUrl,
    image: view.organization.logoUrl,
    telephone: organization.phone,
    email: organization.email,
    address:
      organization.city || organization.state
        ? compact({
            "@type": "PostalAddress",
            addressLocality: organization.city,
            addressRegion: organization.state,
            addressCountry: "BR",
          })
        : undefined,
    identifier: organization.creci
      ? { "@type": "PropertyValue", propertyID: "CRECI", value: organization.creci }
      : undefined,
  })

  return [listing, agent]
}

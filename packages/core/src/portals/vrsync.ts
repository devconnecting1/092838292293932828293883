import { isValidPostalCode } from "../br/documents"
import { isStateCode } from "../br/states"
import {
  requiredPrices,
  requiresLotArea,
  type AddressDisplay,
  type ListingPurpose,
  type PropertyType,
  type PropertyUsage,
} from "../properties/enums"

/**
 * Geração do feed VRSync (Grupo OLX: ZAP Imóveis, Viva Real, OLX).
 * Documentação oficial: https://developers.grupozap.com/feeds/vrsync/
 *
 * A estrutura XML abaixo segue os elementos confirmados na documentação
 * pública (namespace, Header, ListingID/Title/Description, TransactionType,
 * displayAddress, mínimo de 5 fotos, foto primária, VirtualTourLink) — ver
 * comentários pontuais para cada valor/elemento e sua fonte. Preços, taxas,
 * áreas, cômodos e características ficam diretamente dentro de <Details>
 * (sem wrapper próprio, exceto <Features> para a lista de comodidades), com
 * nomes, atributos e ordem confirmados em
 * https://developers.grupozap.com/feeds/vrsync/elements/details.html e no
 * exemplo de https://developers.grupozap.com/feeds/vrsync/examples.html
 * (consultado em 2026-09-15).
 */

// ---------------------------------------------------------------------------
// Tipos de entrada
// ---------------------------------------------------------------------------

export interface VrsyncImage {
  url: string
  caption?: string
  isCover?: boolean
}

export interface VrsyncAddress {
  country: "BR"
  /** UF (sigla), ex.: "SP". */
  state: string
  city: string
  neighborhood: string
  street?: string
  number?: string
  complement?: string
  postalCode: string
  latitude?: number
  longitude?: number
  display: AddressDisplay
}

export type VrsyncPublicationType = "STANDARD" | "PREMIUM" | "SUPER_PREMIUM"

export interface VrsyncListingPrices {
  salePrice?: number
  rentPrice?: number
}

export interface VrsyncListingInput {
  code: string
  title: string
  description: string
  purpose: ListingPurpose
  usage: PropertyUsage
  type: PropertyType
  prices: VrsyncListingPrices
  condoFee?: number
  iptuYearly?: number
  livingArea?: number
  lotArea?: number
  bedrooms?: number
  bathrooms?: number
  suites?: number
  parkingSpaces?: number
  features?: string[]
  address: VrsyncAddress
  images: VrsyncImage[]
  videoUrl?: string
  tourUrl?: string
  detailUrl?: string
  publicationType?: VrsyncPublicationType
}

export interface VrsyncFeedHeader {
  provider: string
  email: string
  contactName: string
  telephone: string
  publishDate: Date
}

// ---------------------------------------------------------------------------
// Mapeamentos de valores oficiais do VRSync
// ---------------------------------------------------------------------------

/**
 * Mapeia (usage, type) do domínio para o par "Usage / PropertyType" do
 * VRSync, no formato usado pela documentação de Details.
 *
 * Valores confirmados em
 * https://developers.grupozap.com/feeds/vrsync/elements/details.html em
 * 2026-09-15: Residential / Apartment, Residential / Home, Residential /
 * Condo, Residential / Penthouse, Residential / Flat, Residential / Studio,
 * Residential / Kitnet, Residential / Land Lot, Residential / Farm Ranch,
 * Commercial / Office, Commercial / Business, Commercial / Industrial,
 * Commercial / Building, Commercial / Land Lot.
 *
 * Sem equivalente oficial direto (best-effort documentado abaixo):
 * - "studio": a doc lista tanto "Residential / Studio" quanto
 *   "Residential / Kitnet" como valores distintos; nosso enum PropertyType
 *   une os dois conceitos em um único tipo "studio" (rótulo
 *   "Studio/Kitnet"), então adotamos "Residential / Kitnet" (termo mais
 *   comum no mercado imobiliário brasileiro para o produto).
 * - "ranch": não há valor oficial específico para "sítio/chácara"; usamos o
 *   mesmo valor de "farm" ("Residential / Farm Ranch"), como a própria doc
 *   sugere ao agrupar os dois conceitos num único item da lista.
 * - "other": não existe categoria genérica "Outro" no VRSync; aplicamos o
 *   valor mais próximo da categoria de uso (Home para residencial/rural,
 *   Business para comercial/industrial). Anúncios com type "other" devem
 *   ser revisados manualmente antes da publicação.
 */
export function mapPropertyTypeToVrsync(usage: PropertyUsage, type: PropertyType): string {
  switch (type) {
    case "apartment":
      return "Residential / Apartment"
    case "house":
      return "Residential / Home"
    case "condo_house":
      return "Residential / Condo"
    case "penthouse":
      return "Residential / Penthouse"
    case "studio":
      return "Residential / Kitnet"
    case "flat":
      return "Residential / Flat"
    case "land":
      return usage === "commercial" || usage === "industrial"
        ? "Commercial / Land Lot"
        : "Residential / Land Lot"
    case "commercial_room":
      return "Commercial / Office"
    case "office":
      return "Commercial / Office"
    case "store":
      return "Commercial / Business"
    case "warehouse":
      return "Commercial / Industrial"
    case "building":
      return "Commercial / Building"
    case "farm":
      return "Residential / Farm Ranch"
    case "ranch":
      return "Residential / Farm Ranch"
    case "other":
      return usage === "commercial" || usage === "industrial"
        ? "Commercial / Business"
        : "Residential / Home"
  }
}

/** Fonte: https://developers.grupozap.com/feeds/vrsync/elements/details.html */
export function mapPurposeToTransactionType(purpose: ListingPurpose): string {
  switch (purpose) {
    case "sale":
      return "For Sale"
    case "rent":
      return "For Rent"
    case "sale_rent":
      return "Sale/Rent"
  }
}

/** Fonte: https://developers.grupozap.com/feeds/vrsync/elements/listing.html (atributo displayAddress). */
export function mapAddressDisplay(display: AddressDisplay): string {
  switch (display) {
    case "full":
      return "All"
    case "street":
      return "Street"
    case "neighborhood":
      return "Neighborhood"
  }
}

// ---------------------------------------------------------------------------
// Validação
// ---------------------------------------------------------------------------

export interface VrsyncValidationIssue {
  field: string
  message: string
  severity: "error" | "warning"
}

export interface VrsyncValidationResult {
  valid: boolean
  issues: VrsyncValidationIssue[]
}

const YOUTUBE_URL_PATTERN = /^https:\/\/(www\.)?(youtube\.com\/|youtu\.be\/)/i

export function validateVrsyncListing(input: VrsyncListingInput): VrsyncValidationResult {
  const issues: VrsyncValidationIssue[] = []

  if (input.code.length < 1 || input.code.length > 50) {
    issues.push({
      field: "code",
      message: "O identificador do anúncio (ListingID) deve ter entre 1 e 50 caracteres.",
      severity: "error",
    })
  }

  if (input.title.length < 10 || input.title.length > 100) {
    issues.push({
      field: "title",
      message: "O título deve ter entre 10 e 100 caracteres.",
      severity: "error",
    })
  }

  if (input.description.length < 50 || input.description.length > 3000) {
    issues.push({
      field: "description",
      message: "A descrição deve ter entre 50 e 3000 caracteres.",
      severity: "error",
    })
  }

  for (const field of requiredPrices(input.purpose)) {
    const value = input.prices[field]
    if (typeof value !== "number" || value <= 0) {
      issues.push({
        field: `prices.${field}`,
        message: "Informe um preço válido para a finalidade selecionada.",
        severity: "error",
      })
    } else if (!Number.isInteger(value)) {
      issues.push({
        field: `prices.${field}`,
        message: "O preço deve ser um valor inteiro em reais (BRL), sem centavos.",
        severity: "error",
      })
    }
  }

  if (input.images.length < 5) {
    issues.push({
      field: "images",
      message: "São necessárias ao menos 5 fotos para publicar no portal.",
      severity: "error",
    })
  }
  input.images.forEach((image, index) => {
    if (!image.url.startsWith("https://")) {
      issues.push({
        field: `images[${index}].url`,
        message: "As imagens devem usar URL https.",
        severity: "error",
      })
    }
  })

  if (input.videoUrl && !YOUTUBE_URL_PATTERN.test(input.videoUrl)) {
    issues.push({
      field: "videoUrl",
      message: "O vídeo deve ser um link do YouTube em https.",
      severity: "error",
    })
  }

  if (input.tourUrl && !input.tourUrl.startsWith("https://")) {
    issues.push({
      field: "tourUrl",
      message: "O tour virtual deve usar uma URL https.",
      severity: "error",
    })
  }

  const needsLotArea = requiresLotArea(input.type)
  const area = needsLotArea ? input.lotArea : input.livingArea
  if (typeof area !== "number" || area <= 0) {
    issues.push({
      field: needsLotArea ? "lotArea" : "livingArea",
      message: "Informe a área exigida para o tipo de imóvel.",
      severity: "error",
    })
  }

  if (!isValidPostalCode(input.address.postalCode)) {
    issues.push({
      field: "address.postalCode",
      message: "Informe um CEP válido.",
      severity: "error",
    })
  }

  if (!isStateCode(input.address.state)) {
    issues.push({
      field: "address.state",
      message: "Informe uma UF válida.",
      severity: "error",
    })
  }

  if (!input.address.neighborhood.trim()) {
    issues.push({
      field: "address.neighborhood",
      message: "O bairro é obrigatório.",
      severity: "error",
    })
  }

  if (!input.address.city.trim()) {
    issues.push({
      field: "address.city",
      message: "A cidade é obrigatória.",
      severity: "error",
    })
  }

  if (!input.detailUrl) {
    issues.push({
      field: "detailUrl",
      message: "Recomenda-se informar a URL da página de detalhes do imóvel no site.",
      severity: "warning",
    })
  }

  const valid = issues.every((issue) => issue.severity !== "error")

  return { valid, issues }
}

// ---------------------------------------------------------------------------
// Geração do XML
// ---------------------------------------------------------------------------

export interface VrsyncBuildResult {
  xml: string
  included: string[]
  skipped: { code: string; issues: VrsyncValidationIssue[] }[]
}

const VRSYNC_NAMESPACE = "http://www.vivareal.com/schemas/1.0/VRSync"
const VRSYNC_SCHEMA_LOCATION = `${VRSYNC_NAMESPACE} http://xml.vivareal.com/vrsync.xsd`

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;")
}

/** Envolve o texto em CDATA, escapando ocorrências da sequência de fechamento "]]>". */
function toCData(value: string): string {
  const safe = value.split("]]>").join("]]]]><![CDATA[>")
  return `<![CDATA[${safe}]]>`
}

function formatMoney(value: number): string {
  return String(Math.round(value))
}

/** Formato de data exigido pelo Header: "AAAA-MM-DDThh:mm:ss" (sem milissegundos/timezone). */
function formatPublishDate(date: Date): string {
  return date.toISOString().replace(/\.\d{3}Z$/, "")
}

function buildHeaderXml(header: VrsyncFeedHeader): string {
  return [
    "  <Header>",
    `    <Provider>${escapeXml(header.provider)}</Provider>`,
    `    <Email>${escapeXml(header.email)}</Email>`,
    `    <ContactName>${escapeXml(header.contactName)}</ContactName>`,
    `    <PublishDate>${formatPublishDate(header.publishDate)}</PublishDate>`,
    `    <Telephone>${escapeXml(header.telephone)}</Telephone>`,
    "  </Header>",
  ].join("\n")
}

/** Ordena as imagens colocando a foto de capa (isCover) em primeiro lugar. */
function orderImagesWithCoverFirst(images: VrsyncImage[]): VrsyncImage[] {
  const coverIndex = images.findIndex((image) => image.isCover)
  if (coverIndex <= 0) return images

  const cover = images[coverIndex]
  if (!cover) return images

  return [cover, ...images.slice(0, coverIndex), ...images.slice(coverIndex + 1)]
}

function buildListingXml(listing: VrsyncListingInput, header: VrsyncFeedHeader): string {
  const lines: string[] = []

  lines.push("    <Listing>")
  lines.push(`      <ListingID>${escapeXml(listing.code)}</ListingID>`)
  lines.push(`      <Title>${toCData(listing.title)}</Title>`)
  lines.push(`      <Description>${toCData(listing.description)}</Description>`)
  lines.push(
    `      <TransactionType>${escapeXml(mapPurposeToTransactionType(listing.purpose))}</TransactionType>`
  )

  // Preços, taxas, áreas, cômodos, garagem e comodidades ficam diretamente
  // dentro de <Details>, na ordem do exemplo oficial (não há wrapper
  // <Prices>, e <Features> envolve somente a lista de comodidades).
  // Fonte: https://developers.grupozap.com/feeds/vrsync/elements/details.html
  // e https://developers.grupozap.com/feeds/vrsync/examples.html
  const [usageType, propertyType] = mapPropertyTypeToVrsync(listing.usage, listing.type).split(
    " / "
  )
  lines.push("      <Details>")
  lines.push(`        <UsageType>${escapeXml(usageType ?? "")}</UsageType>`)
  lines.push(`        <PropertyType>${escapeXml(propertyType ?? "")}</PropertyType>`)

  if (
    (listing.purpose === "sale" || listing.purpose === "sale_rent") &&
    typeof listing.prices.salePrice === "number"
  ) {
    lines.push(
      `        <ListPrice currency="BRL">${formatMoney(listing.prices.salePrice)}</ListPrice>`
    )
  }
  if (
    (listing.purpose === "rent" || listing.purpose === "sale_rent") &&
    typeof listing.prices.rentPrice === "number"
  ) {
    lines.push(
      `        <RentalPrice currency="BRL" period="Monthly">${formatMoney(listing.prices.rentPrice)}</RentalPrice>`
    )
  }

  if (typeof listing.lotArea === "number") {
    lines.push(`        <LotArea unit="square metres">${listing.lotArea}</LotArea>`)
  }
  const mainArea = requiresLotArea(listing.type) ? listing.lotArea : listing.livingArea
  if (typeof mainArea === "number") {
    lines.push(`        <LivingArea unit="square metres">${mainArea}</LivingArea>`)
  }

  if (typeof listing.condoFee === "number") {
    lines.push(
      `        <PropertyAdministrationFee currency="BRL">${formatMoney(listing.condoFee)}</PropertyAdministrationFee>`
    )
  }
  if (typeof listing.iptuYearly === "number") {
    lines.push(
      `        <Iptu currency="BRL" period="Yearly">${formatMoney(listing.iptuYearly)}</Iptu>`
    )
  }

  if (typeof listing.bedrooms === "number") {
    lines.push(`        <Bedrooms>${listing.bedrooms}</Bedrooms>`)
  }
  if (typeof listing.bathrooms === "number") {
    lines.push(`        <Bathrooms>${listing.bathrooms}</Bathrooms>`)
  }
  if (typeof listing.suites === "number") {
    lines.push(`        <Suites>${listing.suites}</Suites>`)
  }
  if (typeof listing.parkingSpaces === "number") {
    lines.push(`        <Garage type="Parking Space">${listing.parkingSpaces}</Garage>`)
  }

  if (listing.features && listing.features.length > 0) {
    lines.push("        <Features>")
    for (const feature of listing.features) {
      lines.push(`          <Feature>${escapeXml(feature)}</Feature>`)
    }
    lines.push("        </Features>")
  }

  lines.push("      </Details>")

  // Privacidade (LGPD): o proprietário escolhe, por anúncio, quanto do
  // endereço aparece nos portais (address.display). O VRSync exige sempre
  // Country/State/City/Neighborhood/PostalCode (mesmo em "neighborhood" —
  // o CEP não identifica o imóvel exato e é obrigatório no schema), mas rua,
  // número, complemento e coordenadas exatas só podem sair quando o modo de
  // exibição autoriza:
  //   - "full"          (displayAddress="All"): tudo, como hoje.
  //   - "street"        (displayAddress="Street"): só a rua (Address), sem
  //                       número/complemento/coordenadas.
  //   - "neighborhood"  (displayAddress="Neighborhood"): nada disso, nem a
  //                       rua.
  const { display } = listing.address
  const canShowStreet = display === "full" || display === "street"
  const canShowExactLocation = display === "full"

  lines.push(`      <Location displayAddress="${escapeXml(mapAddressDisplay(display))}">`)
  lines.push('        <Country abbreviation="BR">Brazil</Country>')
  lines.push(`        <State abbreviation="${escapeXml(listing.address.state)}"></State>`)
  lines.push(`        <City>${escapeXml(listing.address.city)}</City>`)
  lines.push(`        <Neighborhood>${escapeXml(listing.address.neighborhood)}</Neighborhood>`)
  if (canShowStreet && listing.address.street) {
    lines.push(`        <Address>${escapeXml(listing.address.street)}</Address>`)
  }
  if (canShowExactLocation && listing.address.number) {
    lines.push(`        <StreetNumber>${escapeXml(listing.address.number)}</StreetNumber>`)
  }
  if (canShowExactLocation && listing.address.complement) {
    lines.push(`        <Complement>${escapeXml(listing.address.complement)}</Complement>`)
  }
  lines.push(`        <PostalCode>${escapeXml(listing.address.postalCode)}</PostalCode>`)
  if (canShowExactLocation && typeof listing.address.latitude === "number") {
    lines.push(`        <Latitude>${listing.address.latitude}</Latitude>`)
  }
  if (canShowExactLocation && typeof listing.address.longitude === "number") {
    lines.push(`        <Longitude>${listing.address.longitude}</Longitude>`)
  }
  lines.push("      </Location>")

  lines.push("      <Media>")
  const orderedImages = orderImagesWithCoverFirst(listing.images)
  orderedImages.forEach((image, index) => {
    const primaryAttr = index === 0 ? ' primary="true"' : ""
    const captionAttr = image.caption ? ` caption="${escapeXml(image.caption)}"` : ""
    lines.push(
      `        <Item medium="image"${primaryAttr}${captionAttr}>${escapeXml(image.url)}</Item>`
    )
  })
  if (listing.videoUrl) {
    lines.push(`        <Item medium="video">${escapeXml(listing.videoUrl)}</Item>`)
  }
  lines.push("      </Media>")

  if (listing.tourUrl) {
    lines.push(`      <VirtualTourLink>${escapeXml(listing.tourUrl)}</VirtualTourLink>`)
  }
  if (listing.detailUrl) {
    lines.push(`      <DetailViewUrl>${escapeXml(listing.detailUrl)}</DetailViewUrl>`)
  }
  if (listing.publicationType) {
    lines.push(`      <PublicationType>${escapeXml(listing.publicationType)}</PublicationType>`)
  }

  lines.push("      <ContactInfo>")
  lines.push(`        <Name>${escapeXml(header.contactName)}</Name>`)
  lines.push(`        <Email>${escapeXml(header.email)}</Email>`)
  lines.push("      </ContactInfo>")

  lines.push("    </Listing>")

  return lines.join("\n")
}

export function buildVrsyncFeed(
  header: VrsyncFeedHeader,
  listings: VrsyncListingInput[]
): VrsyncBuildResult {
  const included: string[] = []
  const skipped: { code: string; issues: VrsyncValidationIssue[] }[] = []
  const listingBlocks: string[] = []

  for (const listing of listings) {
    const result = validateVrsyncListing(listing)
    if (!result.valid) {
      skipped.push({ code: listing.code, issues: result.issues })
      continue
    }
    included.push(listing.code)
    listingBlocks.push(buildListingXml(listing, header))
  }

  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<ListingDataFeed xmlns="${VRSYNC_NAMESPACE}" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="${VRSYNC_SCHEMA_LOCATION}">`,
    buildHeaderXml(header),
    "  <Listings>",
    ...listingBlocks,
    "  </Listings>",
    "</ListingDataFeed>",
  ].join("\n")

  return { xml, included, skipped }
}

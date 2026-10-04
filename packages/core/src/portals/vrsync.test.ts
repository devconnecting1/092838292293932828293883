import { describe, expect, it } from "vitest"
import {
  buildVrsyncFeed,
  mapAddressDisplay,
  mapPropertyTypeToVrsync,
  mapPurposeToTransactionType,
  validateVrsyncListing,
  type VrsyncFeedHeader,
  type VrsyncListingInput,
} from "./vrsync"

const header: VrsyncFeedHeader = {
  provider: "Imob Plataforma",
  email: "contato@imobplataforma.com.br",
  contactName: "Imob Plataforma",
  telephone: "11-3456-7890",
  publishDate: new Date("2026-09-15T12:00:00Z"),
}

function minimalValidListing(overrides: Partial<VrsyncListingInput> = {}): VrsyncListingInput {
  return {
    code: "AP001",
    title: "Apartamento novo no centro",
    description:
      "Excelente apartamento de 2 quartos, bem localizado, próximo ao metrô, mercados e escolas da região central.",
    purpose: "sale",
    usage: "residential",
    type: "apartment",
    prices: { salePrice: 500_000 },
    livingArea: 75,
    bedrooms: 2,
    bathrooms: 1,
    address: {
      country: "BR",
      state: "SP",
      city: "São Paulo",
      neighborhood: "Centro",
      street: "Rua Exemplo",
      number: "100",
      postalCode: "01001-000",
      latitude: -23.55,
      longitude: -46.63,
      display: "full",
    },
    images: [
      { url: "https://example.com/1.jpg", isCover: true },
      { url: "https://example.com/2.jpg" },
      { url: "https://example.com/3.jpg" },
      { url: "https://example.com/4.jpg" },
      { url: "https://example.com/5.jpg" },
    ],
    ...overrides,
  }
}

describe("mapPropertyTypeToVrsync", () => {
  it("mapeia os tipos residenciais confirmados na documentação", () => {
    expect(mapPropertyTypeToVrsync("residential", "apartment")).toBe("Residential / Apartment")
    expect(mapPropertyTypeToVrsync("residential", "house")).toBe("Residential / Home")
    expect(mapPropertyTypeToVrsync("residential", "condo_house")).toBe("Residential / Condo")
    expect(mapPropertyTypeToVrsync("residential", "penthouse")).toBe("Residential / Penthouse")
    expect(mapPropertyTypeToVrsync("residential", "flat")).toBe("Residential / Flat")
    expect(mapPropertyTypeToVrsync("residential", "farm")).toBe("Residential / Farm Ranch")
    expect(mapPropertyTypeToVrsync("residential", "ranch")).toBe("Residential / Farm Ranch")
  })

  it("mapeia os tipos comerciais confirmados na documentação", () => {
    expect(mapPropertyTypeToVrsync("commercial", "commercial_room")).toBe("Commercial / Office")
    expect(mapPropertyTypeToVrsync("commercial", "office")).toBe("Commercial / Office")
    expect(mapPropertyTypeToVrsync("commercial", "store")).toBe("Commercial / Business")
    expect(mapPropertyTypeToVrsync("commercial", "warehouse")).toBe("Commercial / Industrial")
    expect(mapPropertyTypeToVrsync("commercial", "building")).toBe("Commercial / Building")
  })

  it("land depende do uso (residencial vs. comercial/industrial)", () => {
    expect(mapPropertyTypeToVrsync("residential", "land")).toBe("Residential / Land Lot")
    expect(mapPropertyTypeToVrsync("commercial", "land")).toBe("Commercial / Land Lot")
    expect(mapPropertyTypeToVrsync("industrial", "land")).toBe("Commercial / Land Lot")
  })

  it("'other' usa o valor genérico mais próximo do uso (sem equivalente oficial direto)", () => {
    expect(mapPropertyTypeToVrsync("residential", "other")).toBe("Residential / Home")
    expect(mapPropertyTypeToVrsync("commercial", "other")).toBe("Commercial / Business")
  })
})

describe("mapPurposeToTransactionType", () => {
  it("mapeia sale/rent/sale_rent", () => {
    expect(mapPurposeToTransactionType("sale")).toBe("For Sale")
    expect(mapPurposeToTransactionType("rent")).toBe("For Rent")
    expect(mapPurposeToTransactionType("sale_rent")).toBe("Sale/Rent")
  })
})

describe("mapAddressDisplay", () => {
  it("mapeia full/street/neighborhood", () => {
    expect(mapAddressDisplay("full")).toBe("All")
    expect(mapAddressDisplay("street")).toBe("Street")
    expect(mapAddressDisplay("neighborhood")).toBe("Neighborhood")
  })
})

describe("validateVrsyncListing", () => {
  it("aceita um anúncio mínimo válido", () => {
    const result = validateVrsyncListing(minimalValidListing())
    expect(result.valid).toBe(true)
    expect(result.issues.filter((issue) => issue.severity === "error")).toHaveLength(0)
  })

  it("rejeita ListingID fora do intervalo 1-50", () => {
    const result = validateVrsyncListing(minimalValidListing({ code: "A".repeat(51) }))
    expect(result.valid).toBe(false)
    expect(result.issues).toContainEqual(
      expect.objectContaining({ field: "code", severity: "error" })
    )
  })

  it("rejeita título fora do intervalo 10-100", () => {
    const result = validateVrsyncListing(minimalValidListing({ title: "curto" }))
    expect(result.valid).toBe(false)
    expect(result.issues).toContainEqual(
      expect.objectContaining({ field: "title", severity: "error" })
    )
  })

  it("rejeita descrição fora do intervalo 50-3000", () => {
    const result = validateVrsyncListing(minimalValidListing({ description: "muito curta" }))
    expect(result.valid).toBe(false)
    expect(result.issues).toContainEqual(
      expect.objectContaining({ field: "description", severity: "error" })
    )
  })

  it("rejeita quando falta o preço exigido pela finalidade", () => {
    const result = validateVrsyncListing(minimalValidListing({ prices: {} }))
    expect(result.valid).toBe(false)
    expect(result.issues).toContainEqual(
      expect.objectContaining({ field: "prices.salePrice", severity: "error" })
    )
  })

  it("rejeita preço não inteiro", () => {
    const result = validateVrsyncListing(minimalValidListing({ prices: { salePrice: 500_000.5 } }))
    expect(result.valid).toBe(false)
    expect(result.issues).toContainEqual(
      expect.objectContaining({ field: "prices.salePrice", severity: "error" })
    )
  })

  it("rejeita menos de 5 imagens", () => {
    const result = validateVrsyncListing(
      minimalValidListing({ images: [{ url: "https://example.com/1.jpg" }] })
    )
    expect(result.valid).toBe(false)
    expect(result.issues).toContainEqual(
      expect.objectContaining({ field: "images", severity: "error" })
    )
  })

  it("rejeita imagem sem https", () => {
    const result = validateVrsyncListing(
      minimalValidListing({
        images: [
          { url: "http://example.com/1.jpg" },
          { url: "https://example.com/2.jpg" },
          { url: "https://example.com/3.jpg" },
          { url: "https://example.com/4.jpg" },
          { url: "https://example.com/5.jpg" },
        ],
      })
    )
    expect(result.valid).toBe(false)
    expect(result.issues).toContainEqual(
      expect.objectContaining({ field: "images[0].url", severity: "error" })
    )
  })

  it("rejeita vídeo que não seja do YouTube", () => {
    const result = validateVrsyncListing(
      minimalValidListing({ videoUrl: "https://vimeo.com/12345" })
    )
    expect(result.valid).toBe(false)
    expect(result.issues).toContainEqual(
      expect.objectContaining({ field: "videoUrl", severity: "error" })
    )
  })

  it("aceita vídeo do YouTube em https", () => {
    const result = validateVrsyncListing(
      minimalValidListing({
        videoUrl: "https://www.youtube.com/watch?v=abc123",
      })
    )
    expect(result.valid).toBe(true)
  })

  it("rejeita tour virtual sem https", () => {
    const result = validateVrsyncListing(
      minimalValidListing({ tourUrl: "http://tour.example.com/1" })
    )
    expect(result.valid).toBe(false)
    expect(result.issues).toContainEqual(
      expect.objectContaining({ field: "tourUrl", severity: "error" })
    )
  })

  it("rejeita quando falta a área exigida pelo tipo (imóvel de área construída)", () => {
    const result = validateVrsyncListing(minimalValidListing({ livingArea: undefined }))
    expect(result.valid).toBe(false)
    expect(result.issues).toContainEqual(
      expect.objectContaining({ field: "livingArea", severity: "error" })
    )
  })

  it("rejeita quando falta a área exigida pelo tipo (terreno)", () => {
    const result = validateVrsyncListing(
      minimalValidListing({
        type: "land",
        livingArea: undefined,
        lotArea: undefined,
      })
    )
    expect(result.valid).toBe(false)
    expect(result.issues).toContainEqual(
      expect.objectContaining({ field: "lotArea", severity: "error" })
    )
  })

  it("rejeita CEP inválido", () => {
    const result = validateVrsyncListing(
      minimalValidListing({
        address: { ...minimalValidListing().address, postalCode: "123" },
      })
    )
    expect(result.valid).toBe(false)
    expect(result.issues).toContainEqual(
      expect.objectContaining({
        field: "address.postalCode",
        severity: "error",
      })
    )
  })

  it("rejeita UF inválida", () => {
    const result = validateVrsyncListing(
      minimalValidListing({
        address: { ...minimalValidListing().address, state: "XX" },
      })
    )
    expect(result.valid).toBe(false)
    expect(result.issues).toContainEqual(
      expect.objectContaining({ field: "address.state", severity: "error" })
    )
  })

  it("rejeita bairro vazio", () => {
    const result = validateVrsyncListing(
      minimalValidListing({
        address: { ...minimalValidListing().address, neighborhood: "  " },
      })
    )
    expect(result.valid).toBe(false)
    expect(result.issues).toContainEqual(
      expect.objectContaining({
        field: "address.neighborhood",
        severity: "error",
      })
    )
  })

  it("rejeita cidade vazia", () => {
    const result = validateVrsyncListing(
      minimalValidListing({
        address: { ...minimalValidListing().address, city: "" },
      })
    )
    expect(result.valid).toBe(false)
    expect(result.issues).toContainEqual(
      expect.objectContaining({ field: "address.city", severity: "error" })
    )
  })

  it("emite apenas um aviso (warning) quando falta a URL de detalhes, sem invalidar o anúncio", () => {
    const result = validateVrsyncListing(minimalValidListing({ detailUrl: undefined }))
    expect(result.valid).toBe(true)
    expect(result.issues).toContainEqual(
      expect.objectContaining({ field: "detailUrl", severity: "warning" })
    )
  })

  it("não exige rua, número ou coordenadas quando o modo de exibição os omite (privacidade)", () => {
    const result = validateVrsyncListing(
      minimalValidListing({
        address: {
          ...minimalValidListing().address,
          display: "neighborhood",
          street: undefined,
          number: undefined,
          complement: undefined,
          latitude: undefined,
          longitude: undefined,
        },
      })
    )
    expect(result.valid).toBe(true)
    expect(result.issues.filter((issue) => issue.severity === "error")).toHaveLength(0)
  })
})

describe("buildVrsyncFeed", () => {
  it("gera o XML de um anúncio mínimo válido (snapshot)", () => {
    const result = buildVrsyncFeed(header, [minimalValidListing()])

    expect(result.included).toEqual(["AP001"])
    expect(result.skipped).toEqual([])
    expect(result.xml).toMatchInlineSnapshot(`
      "<?xml version="1.0" encoding="UTF-8"?>
      <ListingDataFeed xmlns="http://www.vivareal.com/schemas/1.0/VRSync" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://www.vivareal.com/schemas/1.0/VRSync http://xml.vivareal.com/vrsync.xsd">
        <Header>
          <Provider>Imob Plataforma</Provider>
          <Email>contato@imobplataforma.com.br</Email>
          <ContactName>Imob Plataforma</ContactName>
          <PublishDate>2026-09-15T12:00:00</PublishDate>
          <Telephone>11-3456-7890</Telephone>
        </Header>
        <Listings>
          <Listing>
            <ListingID>AP001</ListingID>
            <Title><![CDATA[Apartamento novo no centro]]></Title>
            <Description><![CDATA[Excelente apartamento de 2 quartos, bem localizado, próximo ao metrô, mercados e escolas da região central.]]></Description>
            <TransactionType>For Sale</TransactionType>
            <Details>
              <UsageType>Residential</UsageType>
              <PropertyType>Apartment</PropertyType>
              <ListPrice currency="BRL">500000</ListPrice>
              <LivingArea unit="square metres">75</LivingArea>
              <Bedrooms>2</Bedrooms>
              <Bathrooms>1</Bathrooms>
            </Details>
            <Location displayAddress="All">
              <Country abbreviation="BR">Brazil</Country>
              <State abbreviation="SP"></State>
              <City>São Paulo</City>
              <Neighborhood>Centro</Neighborhood>
              <Address>Rua Exemplo</Address>
              <StreetNumber>100</StreetNumber>
              <PostalCode>01001-000</PostalCode>
              <Latitude>-23.55</Latitude>
              <Longitude>-46.63</Longitude>
            </Location>
            <Media>
              <Item medium="image" primary="true">https://example.com/1.jpg</Item>
              <Item medium="image">https://example.com/2.jpg</Item>
              <Item medium="image">https://example.com/3.jpg</Item>
              <Item medium="image">https://example.com/4.jpg</Item>
              <Item medium="image">https://example.com/5.jpg</Item>
            </Media>
            <ContactInfo>
              <Name>Imob Plataforma</Name>
              <Email>contato@imobplataforma.com.br</Email>
            </ContactInfo>
          </Listing>
        </Listings>
      </ListingDataFeed>"
    `)
  })

  it("escapa & e < em campos de texto simples", () => {
    const result = buildVrsyncFeed(header, [
      minimalValidListing({
        address: {
          ...minimalValidListing().address,
          neighborhood: "Jardim A&B < C",
        },
      }),
    ])
    expect(result.xml).toContain("<Neighborhood>Jardim A&amp;B &lt; C</Neighborhood>")
    expect(result.xml).not.toContain("Jardim A&B < C")
  })

  it("escapa a sequência de fechamento ]]> dentro de blocos CDATA", () => {
    const result = buildVrsyncFeed(header, [
      minimalValidListing({ description: `${"x".repeat(50)} fim]]>continua` }),
    ])
    expect(result.xml).toContain("]]]]><![CDATA[>")
    expect(result.xml).not.toContain("fim]]>continua")
  })

  it("mantém a foto marcada como capa em primeiro lugar, com primary=true", () => {
    const result = buildVrsyncFeed(header, [
      minimalValidListing({
        images: [
          { url: "https://example.com/1.jpg" },
          { url: "https://example.com/2.jpg", isCover: true },
          { url: "https://example.com/3.jpg" },
          { url: "https://example.com/4.jpg" },
          { url: "https://example.com/5.jpg" },
        ],
      }),
    ])
    const mediaSection = result.xml.split("<Media>")[1]?.split("</Media>")[0] ?? ""
    const firstItemLine = mediaSection.trim().split("\n")[0] ?? ""
    expect(firstItemLine).toContain("https://example.com/2.jpg")
    expect(firstItemLine).toContain('primary="true"')
  })

  it("emite preços e taxas diretamente em Details, sem wrapper <Prices> e sem CondominiumFee", () => {
    const result = buildVrsyncFeed(header, [
      minimalValidListing({
        purpose: "sale_rent",
        prices: { salePrice: 860_000, rentPrice: 3_500 },
        condoFee: 980,
        iptuYearly: 1200,
      }),
    ])

    expect(result.xml).not.toContain("<Prices>")
    expect(result.xml).not.toContain("CondominiumFee")
    expect(result.xml).toContain('<ListPrice currency="BRL">860000</ListPrice>')
    expect(result.xml).toContain('<RentalPrice currency="BRL" period="Monthly">3500</RentalPrice>')
    expect(result.xml).toContain(
      '<PropertyAdministrationFee currency="BRL">980</PropertyAdministrationFee>'
    )
    expect(result.xml).toContain('<Iptu currency="BRL" period="Yearly">1200</Iptu>')
  })

  it("finalidade venda (sale) emite apenas ListPrice, nunca RentalPrice", () => {
    const result = buildVrsyncFeed(header, [
      minimalValidListing({
        purpose: "sale",
        prices: { salePrice: 500_000, rentPrice: 3_500 },
      }),
    ])

    expect(result.xml).toContain('<ListPrice currency="BRL">500000</ListPrice>')
    expect(result.xml).not.toContain("<RentalPrice")
  })

  it("finalidade locação (rent) emite apenas RentalPrice, nunca ListPrice", () => {
    const result = buildVrsyncFeed(header, [
      minimalValidListing({
        purpose: "rent",
        prices: { salePrice: 500_000, rentPrice: 3_500 },
      }),
    ])

    expect(result.xml).toContain('<RentalPrice currency="BRL" period="Monthly">3500</RentalPrice>')
    expect(result.xml).not.toContain("<ListPrice")
  })

  it("modo 'full' mantém rua, número, complemento e coordenadas na Location (comportamento atual)", () => {
    const result = buildVrsyncFeed(header, [
      minimalValidListing({
        address: {
          ...minimalValidListing().address,
          display: "full",
          complement: "Bloco B",
        },
      }),
    ])
    const locationSection = result.xml.split("<Location")[1]?.split("</Location>")[0] ?? ""

    expect(result.xml).toContain('<Location displayAddress="All">')
    expect(locationSection).toContain("<Address>Rua Exemplo</Address>")
    expect(locationSection).toContain("<StreetNumber>100</StreetNumber>")
    expect(locationSection).toContain("<Complement>Bloco B</Complement>")
    expect(locationSection).toContain("<Latitude>-23.55</Latitude>")
    expect(locationSection).toContain("<Longitude>-46.63</Longitude>")
  })

  it("modo 'street' emite a rua, mas não StreetNumber, Complement, Latitude nem Longitude (LGPD)", () => {
    const result = buildVrsyncFeed(header, [
      minimalValidListing({
        address: {
          ...minimalValidListing().address,
          display: "street",
          complement: "Bloco B",
        },
      }),
    ])
    const locationSection = result.xml.split("<Location")[1]?.split("</Location>")[0] ?? ""

    expect(result.xml).toContain('<Location displayAddress="Street">')
    expect(locationSection).toContain("<Address>Rua Exemplo</Address>")
    expect(locationSection).not.toContain("<StreetNumber>")
    expect(locationSection).not.toContain("<Complement>")
    expect(locationSection).not.toContain("<Latitude>")
    expect(locationSection).not.toContain("<Longitude>")
    // Sempre obrigatórios no VRSync, independente do modo de exibição:
    expect(locationSection).toContain("<Neighborhood>Centro</Neighborhood>")
    expect(locationSection).toContain("<PostalCode>01001-000</PostalCode>")
  })

  it("modo 'neighborhood' não emite Address, StreetNumber, Complement, Latitude nem Longitude (LGPD)", () => {
    const result = buildVrsyncFeed(header, [
      minimalValidListing({
        address: {
          ...minimalValidListing().address,
          display: "neighborhood",
          complement: "Bloco B",
        },
      }),
    ])
    const locationSection = result.xml.split("<Location")[1]?.split("</Location>")[0] ?? ""

    expect(result.xml).toContain('<Location displayAddress="Neighborhood">')
    expect(locationSection).not.toContain("<Address>")
    expect(locationSection).not.toContain("<StreetNumber>")
    expect(locationSection).not.toContain("<Complement>")
    expect(locationSection).not.toContain("<Latitude>")
    expect(locationSection).not.toContain("<Longitude>")
    // Country/State/City/Neighborhood/PostalCode são obrigatórios no VRSync
    // mesmo no modo mais restritivo — o CEP sozinho não expõe o imóvel exato.
    expect(locationSection).toContain("<Neighborhood>Centro</Neighborhood>")
    expect(locationSection).toContain("<PostalCode>01001-000</PostalCode>")
  })

  it("deixa anúncios inválidos fora do XML e os lista em skipped", () => {
    const valid = minimalValidListing({ code: "OK001" })
    const invalid = minimalValidListing({ code: "BAD001", title: "curto" })

    const result = buildVrsyncFeed(header, [valid, invalid])

    expect(result.included).toEqual(["OK001"])
    expect(result.skipped).toHaveLength(1)
    expect(result.skipped[0]?.code).toBe("BAD001")
    expect(result.skipped[0]?.issues.some((issue) => issue.field === "title")).toBe(true)
    expect(result.xml).toContain("OK001")
    expect(result.xml).not.toContain("BAD001")
  })
})

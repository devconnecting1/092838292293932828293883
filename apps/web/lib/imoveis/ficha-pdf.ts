import "server-only"

// Ficha do imóvel em PDF A4, gerada no servidor com pdf-lib (JavaScript puro:
// roda na função serverless da Vercel). Mesmo desenho do PDF da proposta
// (lib/propostas/pdf.ts): faixa com a cor e o logo da imobiliária, Geist Regular
// e SemiBold embutidas (lib/pdf/fonts) e todo texto passando por `toPdfText`.
// Corpo com no mínimo 11 pt, para ler impresso e no celular.

import {
  clip,
  endPath,
  popGraphicsState,
  pushGraphicsState,
  rectangle,
  PDFDocument,
  rgb,
  type PDFFont,
  type PDFImage,
  type PDFPage,
} from "pdf-lib"

import { formatBRL } from "@workspace/core/billing/format"
import { toPdfText, wrapText, type SupportsCodePoint } from "@workspace/core/proposals/pdf-text"

import {
  addressDisplayNote,
  type PropertySheetDocument,
  type PropertySheetPhoto,
} from "@/lib/imoveis/ficha-document"
import { embedPdfFonts } from "@/lib/pdf/fonts"

const PDF_PRODUCER = "CRM Imobiliário"

// A4 em pontos (72 dpi).
const PAGE_WIDTH = 595.28
const PAGE_HEIGHT = 841.89
const MARGIN = 44
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2
const FOOTER_HEIGHT = 48

/** Cores do tema (packages/ui/src/styles/globals.css) em sRGB, como no PDF da proposta. */
const INK = rgb(0.102, 0.102, 0.102)
const MUTED = rgb(0.384, 0.384, 0.384)
const BORDER = rgb(0.8, 0.8, 0.8)
const SOFT = rgb(0.949, 0.949, 0.949)
const WHITE = rgb(1, 1, 1)

type Rgb = ReturnType<typeof rgb>

function hexToRgb(hex: string | null): Rgb | null {
  if (!hex || !/^#[0-9a-fA-F]{6}$/.test(hex)) return null
  const value = Number.parseInt(hex.slice(1), 16)
  return rgb(((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255)
}

/** Branco ou quase preto sobre a cor da marca, pelo contraste. */
function foregroundOn(color: Rgb): Rgb {
  const channel = (value: number) =>
    value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  const luminance =
    0.2126 * channel(color.red) + 0.7152 * channel(color.green) + 0.0722 * channel(color.blue)

  return 1.05 / (luminance + 0.05) >= (luminance + 0.05) / 0.05 ? WHITE : INK
}

type Layout = {
  doc: PDFDocument
  page: PDFPage
  pages: PDFPage[]
  font: PDFFont
  /** Peso forte (Geist SemiBold). */
  bold: PDFFont
  /** O que as fontes desenham: base da limpeza do texto. */
  supports: SupportsCodePoint
  accent: Rgb
  y: number
}

/** Texto limpo para as fontes do documento. */
function pdfText(layout: Layout, value: string | null | undefined) {
  return toPdfText(value, layout.supports)
}

function addPage(layout: Layout) {
  layout.page = layout.doc.addPage([PAGE_WIDTH, PAGE_HEIGHT])
  layout.pages.push(layout.page)
  layout.y = PAGE_HEIGHT - MARGIN
}

function ensure(layout: Layout, height: number) {
  if (layout.y - height < MARGIN + FOOTER_HEIGHT) {
    addPage(layout)
  }
}

function lines(layout: Layout, value: string, font: PDFFont, size: number, width: number) {
  return wrapText(pdfText(layout, value), width, (part) => font.widthOfTextAtSize(part, size))
}

type TextOptions = {
  size?: number
  font?: PDFFont
  color?: Rgb
  width?: number
  x?: number
  maxLines?: number
}

/** Texto quebrado na largura; abre página nova quando precisa. */
function drawParagraph(layout: Layout, value: string, options: TextOptions = {}) {
  const size = options.size ?? 11
  const font = options.font ?? layout.font
  const width = options.width ?? CONTENT_WIDTH
  const x = options.x ?? MARGIN
  const lineHeight = size * 1.4
  let wrapped = lines(layout, value, font, size, width)

  if (options.maxLines && wrapped.length > options.maxLines) {
    wrapped = wrapped.slice(0, options.maxLines)
    const last = wrapped.length - 1
    wrapped[last] = `${(wrapped[last] ?? "").replace(/\s+\S*$/, "")}...`
  }

  ensure(layout, lineHeight * Math.min(wrapped.length, 2))

  for (const line of wrapped) {
    ensure(layout, lineHeight)
    layout.page.drawText(line, { x, y: layout.y - size, size, font, color: options.color ?? INK })
    layout.y -= lineHeight
  }
}

function drawSectionTitle(layout: Layout, title: string) {
  ensure(layout, 60)
  layout.y -= 12
  layout.page.drawText(pdfText(layout, title.toUpperCase()), {
    x: MARGIN,
    y: layout.y - 10,
    size: 10,
    font: layout.bold,
    color: layout.accent,
  })
  layout.y -= 17
  layout.page.drawLine({
    start: { x: MARGIN, y: layout.y },
    end: { x: PAGE_WIDTH - MARGIN, y: layout.y },
    thickness: 0.7,
    color: BORDER,
  })
  layout.y -= 10
}

/** Imagem preenchendo a caixa sem distorcer (recorta as sobras, como object-fit: cover). */
function drawImageCover(
  page: PDFPage,
  image: PDFImage,
  box: { x: number; y: number; width: number; height: number }
) {
  const scale = Math.max(box.width / image.width, box.height / image.height)
  const width = image.width * scale
  const height = image.height * scale

  page.pushOperators(
    pushGraphicsState(),
    rectangle(box.x, box.y, box.width, box.height),
    clip(),
    endPath()
  )
  page.drawImage(image, {
    x: box.x + (box.width - width) / 2,
    y: box.y + (box.height - height) / 2,
    width,
    height,
  })
  page.pushOperators(popGraphicsState())
}

function formatCreci(value: string) {
  return /^creci/i.test(value) ? value : `CRECI ${value}`
}

function money(value: number | null) {
  return value == null || value <= 0
    ? null
    : formatBRL(Math.round(value * 100), { omitZeroCents: true })
}

const numberFormat = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 })

const dateTimeFormat = new Intl.DateTimeFormat("pt-BR", {
  dateStyle: "short",
  timeStyle: "short",
  timeZone: "America/Sao_Paulo",
})

function drawHeader(layout: Layout, sheet: PropertySheetDocument, logo: PDFImage | null) {
  const { organization } = sheet
  const top = PAGE_HEIGHT
  const bandHeight = 88

  layout.page.drawRectangle({
    x: 0,
    y: top - bandHeight,
    width: PAGE_WIDTH,
    height: bandHeight,
    color: layout.accent,
  })

  const onAccent = foregroundOn(layout.accent)
  let textX = MARGIN

  if (logo) {
    const scale = Math.min(120 / logo.width, 44 / logo.height, 1)
    const width = logo.width * scale
    const height = logo.height * scale

    layout.page.drawImage(logo, {
      x: MARGIN,
      y: top - bandHeight / 2 - height / 2,
      width,
      height,
    })
    textX = MARGIN + width + 16
  }

  const headerLines = [
    { text: organization.name, size: 14, font: layout.bold },
    {
      text: [
        organization.creci ? formatCreci(organization.creci) : null,
        [organization.city, organization.state].filter(Boolean).join("/"),
      ]
        .filter(Boolean)
        .join(" · "),
      size: 9,
      font: layout.font,
    },
    {
      text: [organization.phone, organization.email].filter(Boolean).join(" · "),
      size: 9,
      font: layout.font,
    },
  ].filter((line) => line.text.length > 0)

  const blockHeight = headerLines.reduce((sum, line) => sum + line.size + 5, -5)
  let lineY = top - bandHeight / 2 + blockHeight / 2

  for (const line of headerLines) {
    const [first] = lines(layout, line.text, line.font, line.size, PAGE_WIDTH - MARGIN - textX)
    layout.page.drawText(first ?? "", {
      x: textX,
      y: lineY - line.size,
      size: line.size,
      font: line.font,
      color: onAccent,
    })
    lineY -= line.size + 5
  }

  layout.y = top - bandHeight - 22
}

function drawTitle(layout: Layout, sheet: PropertySheetDocument) {
  const { property } = sheet

  layout.page.drawText(
    pdfText(layout, `FICHA DO IMÓVEL · ${property.code} · ${property.typeLabel.toUpperCase()}`),
    { x: MARGIN, y: layout.y - 9, size: 9, font: layout.bold, color: MUTED }
  )
  layout.y -= 18

  drawParagraph(layout, property.title, { size: 18, font: layout.bold, maxLines: 3 })

  if (property.address) {
    layout.y -= 2
    drawParagraph(layout, property.address, { size: 11, color: MUTED, maxLines: 2 })
  }

  layout.y -= 8
}

function drawPhotos(layout: Layout, images: PDFImage[]) {
  const [cover, ...rest] = images

  if (!cover) return

  const coverHeight = rest.length > 0 ? 232 : 290
  ensure(layout, coverHeight + 10)
  drawImageCover(layout.page, cover, {
    x: MARGIN,
    y: layout.y - coverHeight,
    width: CONTENT_WIDTH,
    height: coverHeight,
  })
  layout.y -= coverHeight + 8

  if (rest.length === 0) return

  const gap = 8
  const columns = 3
  const thumbWidth = (CONTENT_WIDTH - gap * (columns - 1)) / columns
  const thumbHeight = 92

  ensure(layout, thumbHeight + 10)

  rest.slice(0, columns).forEach((image, index) => {
    drawImageCover(layout.page, image, {
      x: MARGIN + index * (thumbWidth + gap),
      y: layout.y - thumbHeight,
      width: thumbWidth,
      height: thumbHeight,
    })
  })
  layout.y -= thumbHeight + 8
}

function drawPrices(layout: Layout, sheet: PropertySheetDocument) {
  const { property } = sheet
  const prices = [
    { label: "Venda", value: money(property.salePrice), suffix: "" },
    { label: "Locação", value: money(property.rentPrice), suffix: "/mês" },
  ].filter((price) => price.value)
  const extras = [
    money(property.condoFee) ? `Condomínio ${money(property.condoFee)}/mês` : null,
    money(property.iptuYearly) ? `IPTU ${money(property.iptuYearly)}/ano` : null,
  ].filter(Boolean)

  const height = extras.length > 0 ? 76 : 58
  ensure(layout, height + 12)
  layout.y -= 6

  const top = layout.y

  layout.page.drawRectangle({
    x: MARGIN,
    y: top - height,
    width: CONTENT_WIDTH,
    height,
    color: SOFT,
  })
  layout.page.drawRectangle({ x: MARGIN, y: top - height, width: 4, height, color: layout.accent })

  if (prices.length === 0) {
    layout.page.drawText(pdfText(layout, "Valor sob consulta"), {
      x: MARGIN + 18,
      y: top - 36,
      size: 16,
      font: layout.bold,
      color: INK,
    })
  }

  const columnWidth = (CONTENT_WIDTH - 36) / 2

  prices.forEach((price, index) => {
    const x = MARGIN + 18 + index * columnWidth

    layout.page.drawText(pdfText(layout, price.label), {
      x,
      y: top - 20,
      size: 9,
      font: layout.font,
      color: MUTED,
    })
    layout.page.drawText(pdfText(layout, `${price.value}${price.suffix}`), {
      x,
      y: top - 42,
      size: 18,
      font: layout.bold,
      color: INK,
    })
  })

  if (extras.length > 0) {
    layout.page.drawText(pdfText(layout, extras.join(" · ")), {
      x: MARGIN + 18,
      y: top - 64,
      size: 11,
      font: layout.font,
      color: MUTED,
    })
  }

  layout.y = top - height - 6
}

type Fact = { label: string; value: string | null }

function count(value: number | null, singular: string, plural: string) {
  if (value == null || value <= 0) return null
  return `${value} ${value === 1 ? singular : plural}`
}

function facts(sheet: PropertySheetDocument): Fact[] {
  const { property } = sheet

  return [
    { label: "Tipo", value: `${property.typeLabel} (${property.usageLabel.toLowerCase()})` },
    { label: "Finalidade", value: property.purposeLabel },
    {
      label: "Área útil",
      value: property.livingArea ? `${numberFormat.format(property.livingArea)} m²` : null,
    },
    {
      label: "Área do terreno",
      value: property.lotArea ? `${numberFormat.format(property.lotArea)} m²` : null,
    },
    { label: "Quartos", value: count(property.bedrooms, "quarto", "quartos") },
    { label: "Suítes", value: count(property.suites, "suíte", "suítes") },
    { label: "Banheiros", value: count(property.bathrooms, "banheiro", "banheiros") },
    { label: "Vagas", value: count(property.parkingSpaces, "vaga", "vagas") },
    {
      label: "Andar",
      value:
        property.floor == null
          ? null
          : property.floor === 0
            ? "Térreo"
            : `${property.floor}º${property.totalFloors ? ` de ${property.totalFloors}` : ""}`,
    },
    { label: "Ano de construção", value: property.yearBuilt ? String(property.yearBuilt) : null },
    { label: "Condomínio", value: property.condominiumName },
    { label: "Mobiliado", value: property.furnished ? "Sim" : null },
    { label: "Aceita pet", value: property.acceptsPets ? "Sim" : null },
    { label: "Aceita permuta", value: property.acceptsExchange ? "Sim" : null },
  ].filter((fact) => fact.value)
}

function drawFacts(layout: Layout, sheet: PropertySheetDocument) {
  const items = facts(sheet)

  if (items.length === 0) return

  drawSectionTitle(layout, "Características")

  const columns = 3
  const gap = 14
  const columnWidth = (CONTENT_WIDTH - gap * (columns - 1)) / columns
  const rowHeight = 36

  for (let index = 0; index < items.length; index += columns) {
    ensure(layout, rowHeight)

    items.slice(index, index + columns).forEach((fact, column) => {
      const x = MARGIN + column * (columnWidth + gap)
      const [value] = lines(layout, fact.value ?? "", layout.bold, 12, columnWidth)

      layout.page.drawText(pdfText(layout, fact.label), {
        x,
        y: layout.y - 9,
        size: 9,
        font: layout.font,
        color: MUTED,
      })
      layout.page.drawText(value ?? "", {
        x,
        y: layout.y - 25,
        size: 12,
        font: layout.bold,
        color: INK,
      })
    })

    layout.y -= rowHeight
  }
}

function drawContact(layout: Layout, sheet: PropertySheetDocument) {
  const { agent, organization } = sheet
  const name = agent?.name ?? organization.name
  const details = [
    agent?.creci ?? (organization.creci ? formatCreci(organization.creci) : null),
    agent?.phone ?? organization.phone,
    agent?.email ?? organization.email,
  ].filter(Boolean)

  drawSectionTitle(layout, "Fale com")
  drawParagraph(layout, name, { size: 13, font: layout.bold })

  if (details.length > 0) {
    drawParagraph(layout, details.join(" · "), { size: 11 })
  }

  if (agent?.name) {
    drawParagraph(layout, organization.name, { size: 11, color: MUTED })
  }
}

function drawFooters(layout: Layout, sheet: PropertySheetDocument) {
  const { organization } = sheet
  const identity = [
    organization.legalName ?? organization.name,
    organization.cnpj ? `CNPJ ${organization.cnpj}` : null,
    organization.creci ? formatCreci(organization.creci) : null,
  ]
    .filter(Boolean)
    .join(" · ")
  const generatedAt = new Date(sheet.generatedAt)
  const generated = `Ficha gerada em ${
    Number.isNaN(generatedAt.getTime()) ? "—" : dateTimeFormat.format(generatedAt)
  }. Valores e disponibilidade sujeitos a alteração sem aviso.`
  const total = layout.pages.length

  layout.pages.forEach((page, index) => {
    page.drawLine({
      start: { x: MARGIN, y: MARGIN + 28 },
      end: { x: PAGE_WIDTH - MARGIN, y: MARGIN + 28 },
      thickness: 0.7,
      color: BORDER,
    })

    const pageLabel = pdfText(layout, `${index + 1}/${total}`)
    const labelWidth = layout.font.widthOfTextAtSize(pageLabel, 8)
    const [identityLine] = lines(layout, identity, layout.font, 8, CONTENT_WIDTH - labelWidth - 12)
    const [generatedLine] = lines(layout, generated, layout.font, 8, CONTENT_WIDTH)

    page.drawText(identityLine ?? "", {
      x: MARGIN,
      y: MARGIN + 16,
      size: 8,
      font: layout.font,
      color: MUTED,
    })
    page.drawText(generatedLine ?? "", {
      x: MARGIN,
      y: MARGIN + 5,
      size: 8,
      font: layout.font,
      color: MUTED,
    })
    page.drawText(pageLabel, {
      x: PAGE_WIDTH - MARGIN - labelWidth,
      y: MARGIN + 16,
      size: 8,
      font: layout.font,
      color: MUTED,
    })
  })
}

async function embedImage(doc: PDFDocument, bytes: Uint8Array | null, kind?: "jpeg" | "png") {
  if (!bytes || bytes.length === 0) return null

  try {
    const isPng = kind ? kind === "png" : bytes[0] === 0x89 && bytes[1] === 0x50
    return isPng ? await doc.embedPng(bytes) : await doc.embedJpg(bytes)
  } catch {
    return null
  }
}

function slugifyFileName(value: string) {
  const slug = value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")

  return slug || "imovel"
}

export type PropertySheetPdf = {
  /** Cópia com ArrayBuffer próprio: BodyInit não aceita o ArrayBufferLike genérico. */
  bytes: Uint8Array<ArrayBuffer>
  fileName: string
}

/**
 * Desenha a ficha. Logo e fotos são opcionais: imagem que não abre só some,
 * sem derrubar o documento.
 */
export async function renderPropertySheetPdf(
  sheet: PropertySheetDocument,
  photos: readonly PropertySheetPhoto[],
  logoBytes: Uint8Array | null = null
): Promise<PropertySheetPdf> {
  const doc = await PDFDocument.create()
  const fonts = await embedPdfFonts(doc)
  const firstPage = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT])

  const layout: Layout = {
    doc,
    page: firstPage,
    pages: [firstPage],
    font: fonts.regular,
    bold: fonts.semiBold,
    supports: fonts.supports,
    accent: hexToRgb(sheet.organization.brand.primaryColor) ?? INK,
    y: PAGE_HEIGHT - MARGIN,
  }

  const { property } = sheet

  doc.setTitle(`${property.code} · ${property.title}`)
  doc.setAuthor(sheet.organization.name)
  doc.setSubject(`Ficha do imóvel ${property.code}`)
  doc.setProducer(PDF_PRODUCER)
  doc.setCreator(sheet.organization.name)
  doc.setCreationDate(new Date())

  const [logo, ...images] = await Promise.all([
    embedImage(doc, logoBytes),
    ...photos.map((photo) => embedImage(doc, photo.bytes, photo.kind)),
  ])

  drawHeader(layout, sheet, logo ?? null)
  drawTitle(layout, sheet)
  drawPhotos(
    layout,
    images.filter((image): image is PDFImage => image !== null)
  )
  drawPrices(layout, sheet)
  drawFacts(layout, sheet)

  if (property.amenities.length > 0) {
    drawSectionTitle(layout, "Comodidades")
    drawParagraph(layout, property.amenities.join(" · "))
  }

  if (property.description) {
    drawSectionTitle(layout, "Descrição")
    drawParagraph(layout, property.description, { maxLines: 22 })
  }

  drawSectionTitle(layout, "Localização")
  drawParagraph(layout, property.address ?? "Endereço informado no agendamento da visita.")

  const note = addressDisplayNote(property.addressDisplay)

  if (note && property.address) {
    drawParagraph(layout, note, { size: 11, color: MUTED })
  }

  drawContact(layout, sheet)
  drawFooters(layout, sheet)

  const saved = await doc.save()

  return {
    bytes: new Uint8Array(saved),
    fileName: `ficha-${slugifyFileName(property.code)}.pdf`,
  }
}

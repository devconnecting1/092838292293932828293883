import "server-only"

// PDF da proposta, gerado no servidor com pdf-lib (JavaScript puro, sem
// binário nativo: roda na função serverless da Vercel). Nada disso entra no
// bundle do navegador — o módulo é importado só pelos route handlers.
//
// Fonte: Geist Regular e SemiBold embutidas (lib/pdf/fonts), com a Helvetica
// padrão de reserva. Todo texto passa por `toPdfText` antes de ser desenhado
// (ver @workspace/core/proposals/pdf-text).

import { PDFDocument, rgb, type PDFFont, type PDFImage, type PDFPage } from "pdf-lib"

import { formatBRL } from "@workspace/core/billing/format"
import { toPdfText, wrapText, type SupportsCodePoint } from "@workspace/core/proposals/pdf-text"
import { describeRoundTerms } from "@workspace/core/proposals/rounds"

import { formatDateOnly } from "@/lib/chaves/datetime"
import { embedPdfFonts } from "@/lib/pdf/fonts"
import type { ProposalDocument } from "@/lib/propostas/document"

/** Mesmo nome de APP_NAME (components/crm/brand): aqui como texto, para o
 * módulo do PDF não puxar componentes React para a função serverless. */
const PDF_PRODUCER = "CRM Imobiliário"

// A4 em pontos (72 dpi).
const PAGE_WIDTH = 595.28
const PAGE_HEIGHT = 841.89
const MARGIN = 48
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2
const FOOTER_HEIGHT = 46

/**
 * Cores do tema (packages/ui/src/styles/globals.css) convertidas de oklch para
 * sRGB — o PDF não conhece oklch. Nenhuma paleta nova: cinza-neutro do tema,
 * com a cor da marca da imobiliária como destaque quando ela existe.
 */
const INK = rgb(0.102, 0.102, 0.102) // --foreground  oklch(0.2178 0 0)
const MUTED = rgb(0.384, 0.384, 0.384) // --muted-foreground  oklch(0.4983 0 0)
const BORDER = rgb(0.8, 0.8, 0.8) // --border  oklch(0.8452 0 0)
const SOFT = rgb(0.949, 0.949, 0.949) // --muted  oklch(0.9067 0 0)
const WHITE = rgb(1, 1, 1)

type Rgb = ReturnType<typeof rgb>

function hexToRgb(hex: string | null): Rgb | null {
  if (!hex || !/^#[0-9a-fA-F]{6}$/.test(hex)) {
    return null
  }

  const value = Number.parseInt(hex.slice(1), 16)

  return rgb(((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255)
}

/** Branco ou quase preto sobre a cor da marca, pelo contraste (igual à captação). */
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
  font: PDFFont
  /** Peso forte (Geist SemiBold). */
  bold: PDFFont
  /** O que as fontes desenham: base da limpeza do texto. */
  supports: SupportsCodePoint
  accent: Rgb
  /** Linha de base disponível, do topo para baixo. */
  y: number
  pages: PDFPage[]
}

/** Texto limpo para as fontes do documento. */
function pdfText(layout: Layout, value: string | null | undefined) {
  return toPdfText(value, layout.supports)
}

function addPage(layout: Layout) {
  layout.page = layout.doc.addPage([PAGE_WIDTH, PAGE_HEIGHT])
  layout.pages.push(layout.page)
  layout.y = PAGE_HEIGHT - MARGIN

  return layout.page
}

/** Garante espaço para o próximo bloco; abre outra página quando não cabe. */
function ensure(layout: Layout, height: number) {
  if (layout.y - height < MARGIN + FOOTER_HEIGHT) {
    addPage(layout)
  }
}

type TextOptions = {
  size?: number
  font?: PDFFont
  color?: Rgb
  width?: number
  x?: number
  lineGap?: number
}

/** Escreve o texto quebrado na largura disponível e devolve a altura usada. */
function drawParagraph(layout: Layout, value: string, options: TextOptions = {}) {
  const size = options.size ?? 10
  const font = options.font ?? layout.font
  const width = options.width ?? CONTENT_WIDTH
  const x = options.x ?? MARGIN
  const lineHeight = size * 1.35 + (options.lineGap ?? 0)
  const lines = wrapText(pdfText(layout, value), width, (text) =>
    font.widthOfTextAtSize(text, size)
  )

  if (lines.length === 0) {
    return 0
  }

  ensure(layout, lineHeight * Math.min(lines.length, 3))

  for (const line of lines) {
    ensure(layout, lineHeight)
    layout.page.drawText(line, {
      x,
      y: layout.y - size,
      size,
      font,
      color: options.color ?? INK,
    })
    layout.y -= lineHeight
  }

  return lines.length * lineHeight
}

function drawSectionTitle(layout: Layout, title: string) {
  ensure(layout, 34)
  layout.y -= 10

  layout.page.drawText(pdfText(layout, title.toUpperCase()), {
    x: MARGIN,
    y: layout.y - 9,
    size: 9,
    font: layout.bold,
    color: layout.accent,
  })
  layout.y -= 15

  layout.page.drawLine({
    start: { x: MARGIN, y: layout.y },
    end: { x: PAGE_WIDTH - MARGIN, y: layout.y },
    thickness: 0.7,
    color: BORDER,
  })
  layout.y -= 12
}

type Field = { label: string; value: string | null }

function drawField(layout: Layout, field: Field, x: number, width: number) {
  layout.page.drawText(pdfText(layout, field.label), {
    x,
    y: layout.y - 7,
    size: 7.5,
    font: layout.font,
    color: MUTED,
  })
  layout.y -= 11

  drawParagraph(layout, field.value ?? "—", { x, width, size: 10 })
}

/**
 * Uma ou duas colunas de campos, alinhadas pela altura do bloco. Campo sem
 * valor não é desenhado: o documento não fica cheio de traços.
 */
function drawFieldRow(layout: Layout, fields: Field[]) {
  const visible = fields.filter((field) => field.value !== null && field.value !== "")

  if (visible.length === 0) {
    return
  }

  ensure(layout, 36)

  if (visible.length === 1 && visible[0]) {
    drawField(layout, visible[0], MARGIN, CONTENT_WIDTH)
    layout.y -= 6
    return
  }

  const gap = 16
  const columnWidth = (CONTENT_WIDTH - gap) / 2
  const top = layout.y
  let lowest = layout.y

  visible.slice(0, 2).forEach((field, index) => {
    layout.y = top
    drawField(layout, field, MARGIN + index * (columnWidth + gap), columnWidth)
    lowest = Math.min(lowest, layout.y)
  })

  layout.y = lowest - 6
}

/** Bloco de destaque com o valor da proposta. */
function drawAmount(layout: Layout, document: ProposalDocument) {
  const height = 62
  ensure(layout, height + 10)

  const top = layout.y
  const amount = formatBRL(Math.round(document.proposal.amount * 100))

  layout.page.drawRectangle({
    x: MARGIN,
    y: top - height,
    width: CONTENT_WIDTH,
    height,
    color: SOFT,
  })
  layout.page.drawRectangle({
    x: MARGIN,
    y: top - height,
    width: 4,
    height,
    color: layout.accent,
  })

  const purpose = document.proposal.purposeLabel.toLowerCase()
  const amountLabel =
    document.proposal.round?.kind === "owner_counter"
      ? `Contraproposta do proprietário para ${purpose}`
      : `Valor proposto para ${purpose}`

  layout.page.drawText(pdfText(layout, amountLabel), {
    x: MARGIN + 18,
    y: top - 24,
    size: 8.5,
    font: layout.font,
    color: MUTED,
  })
  layout.page.drawText(pdfText(layout, amount), {
    x: MARGIN + 18,
    y: top - 50,
    size: 22,
    font: layout.bold,
    color: INK,
  })

  const listed = document.property?.listedPrice

  if (listed) {
    const label = `Anunciado por ${formatBRL(Math.round(listed * 100))}`
    const width = layout.font.widthOfTextAtSize(pdfText(layout, label), 8.5)

    layout.page.drawText(pdfText(layout, label), {
      x: PAGE_WIDTH - MARGIN - 18 - width,
      y: top - 24,
      size: 8.5,
      font: layout.font,
      color: MUTED,
    })
  }

  layout.y = top - height - 14
}

function drawSignatures(layout: Layout, document: ProposalDocument) {
  ensure(layout, 96)
  layout.y -= 18

  const gap = 32
  const columnWidth = (CONTENT_WIDTH - gap) / 2
  const lineY = layout.y - 30
  const columns = [
    { name: document.client?.name ?? "Proponente", role: "Proponente" },
    {
      name: document.broker?.name ?? document.organization.name,
      role: document.broker?.creci ?? "Pela imobiliária",
    },
  ]

  columns.forEach((column, index) => {
    const x = MARGIN + index * (columnWidth + gap)

    layout.page.drawLine({
      start: { x, y: lineY },
      end: { x: x + columnWidth, y: lineY },
      thickness: 0.8,
      color: INK,
    })

    const name = pdfText(layout, column.name)
    const clipped = wrapText(name, columnWidth, (text) => layout.bold.widthOfTextAtSize(text, 9.5))

    layout.page.drawText(clipped[0] ?? name, {
      x,
      y: lineY - 13,
      size: 9.5,
      font: layout.bold,
      color: INK,
    })
    layout.page.drawText(pdfText(layout, column.role), {
      x,
      y: lineY - 25,
      size: 8,
      font: layout.font,
      color: MUTED,
    })
  })

  layout.y = lineY - 36
}

function drawHeader(layout: Layout, document: ProposalDocument, logo: PDFImage | null) {
  const { organization, proposal } = document
  const top = PAGE_HEIGHT - MARGIN
  const bandHeight = 74

  layout.page.drawRectangle({
    x: 0,
    y: top - bandHeight + 18,
    width: PAGE_WIDTH,
    height: bandHeight + MARGIN - 18,
    color: layout.accent,
  })

  const onAccent = foregroundOn(layout.accent)
  let textX = MARGIN

  if (logo) {
    const maxWidth = 120
    const maxHeight = 40
    const scale = Math.min(maxWidth / logo.width, maxHeight / logo.height, 1)
    const width = logo.width * scale
    const height = logo.height * scale

    layout.page.drawImage(logo, {
      x: MARGIN,
      y: top - 26 - height / 2,
      width,
      height,
    })
    textX = MARGIN + width + 16
  }

  const lines = [
    { text: organization.name, size: 13, font: layout.bold },
    {
      text: [organization.legalName, organization.cnpj ? `CNPJ ${organization.cnpj}` : null]
        .filter(Boolean)
        .join(" · "),
      size: 8,
      font: layout.font,
    },
    {
      text: [
        organization.creci ? formatCreci(organization.creci) : null,
        [organization.city, organization.state].filter(Boolean).join("/"),
      ]
        .filter(Boolean)
        .join(" · "),
      size: 8,
      font: layout.font,
    },
  ].filter((line) => line.text.length > 0)

  let lineY = top - 14

  for (const line of lines) {
    layout.page.drawText(pdfText(layout, line.text), {
      x: textX,
      y: lineY - line.size,
      size: line.size,
      font: line.font,
      color: onAccent,
    })
    lineY -= line.size + 5
  }

  layout.y = top - bandHeight - 12

  const title = proposal.purpose === "rent" ? "Proposta de locação" : "Proposta de compra"

  layout.page.drawText(pdfText(layout, title), {
    x: MARGIN,
    y: layout.y - 17,
    size: 17,
    font: layout.bold,
    color: INK,
  })
  layout.y -= 26

  const reference = `Proposta ${proposal.id.slice(0, 8).toUpperCase()} · registrada em ${formatDateTime(proposal.createdAt)}`

  layout.page.drawText(pdfText(layout, reference), {
    x: MARGIN,
    y: layout.y - 8,
    size: 8.5,
    font: layout.font,
    color: MUTED,
  })
  layout.y -= 16
}

function drawFooters(layout: Layout, document: ProposalDocument) {
  const { organization } = document
  const contact = [
    organization.phone,
    organization.email,
    organization.creci ? formatCreci(organization.creci) : null,
  ]
    .filter(Boolean)
    .join(" · ")
  const generated = `Documento gerado em ${formatDateTime(document.generatedAt)}`
  const total = layout.pages.length

  layout.pages.forEach((page, index) => {
    page.drawLine({
      start: { x: MARGIN, y: MARGIN + 26 },
      end: { x: PAGE_WIDTH - MARGIN, y: MARGIN + 26 },
      thickness: 0.7,
      color: BORDER,
    })

    page.drawText(pdfText(layout, contact || organization.name), {
      x: MARGIN,
      y: MARGIN + 14,
      size: 7.5,
      font: layout.font,
      color: MUTED,
    })
    page.drawText(pdfText(layout, generated), {
      x: MARGIN,
      y: MARGIN + 4,
      size: 7.5,
      font: layout.font,
      color: MUTED,
    })

    const pageLabel = pdfText(layout, `${index + 1}/${total}`)
    const width = layout.font.widthOfTextAtSize(pageLabel, 7.5)

    page.drawText(pageLabel, {
      x: PAGE_WIDTH - MARGIN - width,
      y: MARGIN + 14,
      size: 7.5,
      font: layout.font,
      color: MUTED,
    })
  })
}

function formatCreci(value: string) {
  return /^creci/i.test(value) ? value : `CRECI ${value}`
}

const dateTimeFormat = new Intl.DateTimeFormat("pt-BR", {
  dateStyle: "short",
  timeStyle: "short",
  timeZone: "America/Sao_Paulo",
})

function formatDateTime(value: string | null) {
  if (!value) {
    return "—"
  }

  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? "—" : dateTimeFormat.format(parsed)
}

function formatMeasure(value: number | null, unit: string) {
  return value == null ? null : `${new Intl.NumberFormat("pt-BR").format(value)} ${unit}`
}

function formatMoney(value: number | null) {
  return value == null ? null : formatBRL(Math.round(value * 100))
}

function propertyFeatures(document: ProposalDocument) {
  const property = document.property

  if (!property) {
    return null
  }

  const parts = [
    property.bedrooms ? `${property.bedrooms} dorm.` : null,
    property.suites ? `${property.suites} suíte(s)` : null,
    property.bathrooms ? `${property.bathrooms} banheiro(s)` : null,
    property.parkingSpaces ? `${property.parkingSpaces} vaga(s)` : null,
    formatMeasure(property.livingArea, "m² úteis"),
    formatMeasure(property.lotArea, "m² de terreno"),
  ].filter(Boolean)

  return parts.length > 0 ? parts.join(" · ") : null
}

function documentLabel(client: ProposalDocument["client"]) {
  if (!client?.document) {
    return null
  }

  return client.kind === "pj" ? `CNPJ ${client.document}` : `CPF ${client.document}`
}

export type ProposalPdf = {
  /** Cópia com ArrayBuffer próprio: BodyInit não aceita o ArrayBufferLike genérico. */
  bytes: Uint8Array<ArrayBuffer>
  fileName: string
}

/**
 * Desenha o PDF da proposta. `logoBytes` é opcional: sem logo (ou com uma
 * imagem que não abre), o cabeçalho usa só o nome da imobiliária.
 */
export async function renderProposalPdf(
  document: ProposalDocument,
  logoBytes: Uint8Array | null = null
): Promise<ProposalPdf> {
  const doc = await PDFDocument.create()
  const fonts = await embedPdfFonts(doc)

  const layout: Layout = {
    doc,
    page: doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]),
    font: fonts.regular,
    bold: fonts.semiBold,
    supports: fonts.supports,
    accent: hexToRgb(document.organization.brand.primaryColor) ?? INK,
    y: PAGE_HEIGHT - MARGIN,
    pages: [],
  }

  layout.pages.push(layout.page)

  doc.setTitle(`Proposta ${document.proposal.id.slice(0, 8).toUpperCase()}`)
  doc.setAuthor(document.organization.name)
  doc.setSubject(
    `Proposta de ${document.proposal.purposeLabel.toLowerCase()}${
      document.property ? ` — imóvel ${document.property.code}` : ""
    }`
  )
  doc.setProducer(PDF_PRODUCER)
  doc.setCreator(document.organization.name)
  doc.setCreationDate(new Date())

  const logo = await embedLogo(doc, logoBytes)

  drawHeader(layout, document, logo)

  if (document.property) {
    const property = document.property

    drawSectionTitle(layout, "Imóvel")
    drawFieldRow(layout, [
      { label: "Código", value: property.code },
      {
        label: "Tipo",
        value: [property.typeLabel, property.usageLabel].filter(Boolean).join(" · ") || null,
      },
    ])
    drawFieldRow(layout, [{ label: "Descrição", value: property.title }])
    drawFieldRow(layout, [
      { label: "Endereço", value: property.address },
      {
        label: "CEP e condomínio",
        value: [property.postalCode, property.condominiumName].filter(Boolean).join(" · ") || null,
      },
    ])
    drawFieldRow(layout, [{ label: "Características", value: propertyFeatures(document) }])
    drawFieldRow(layout, [
      { label: "Condomínio (mensal)", value: formatMoney(property.condoFee) },
      { label: "IPTU (anual)", value: formatMoney(property.iptuYearly) },
    ])
  }

  drawSectionTitle(layout, "Proponente")
  drawFieldRow(layout, [
    { label: "Nome", value: document.client?.name ?? null },
    { label: "Documento", value: documentLabel(document.client) },
  ])
  drawFieldRow(layout, [
    { label: "Telefone", value: document.client?.phone ?? null },
    { label: "E-mail", value: document.client?.email ?? null },
  ])

  drawSectionTitle(layout, "Proposta")

  // Rodada vigente da negociação e as condições dela (sinal, financiamento,
  // permuta e prazo), duas por linha.
  const round = document.proposal.round
  if (round) {
    drawFieldRow(layout, [
      { label: "Rodada da negociação", value: `Rodada ${round.number} · ${round.label}` },
      { label: "Registrada em", value: round.createdAt ? formatDateTime(round.createdAt) : null },
    ])
  }

  drawAmount(layout, document)

  const terms = describeRoundTerms(document.proposal.terms, (value) =>
    formatBRL(Math.round(value * 100))
  )
  for (let index = 0; index < terms.length; index += 2) {
    drawFieldRow(layout, terms.slice(index, index + 2))
  }
  drawFieldRow(layout, [{ label: "Forma de pagamento", value: document.proposal.paymentTerms }])
  drawFieldRow(layout, [{ label: "Condições", value: document.proposal.conditions }])
  drawFieldRow(layout, [
    {
      label: "Validade da proposta",
      value: document.proposal.validUntil
        ? formatDateOnly(document.proposal.validUntil)
        : "Sem prazo definido",
    },
    {
      label: "Corretor responsável",
      value:
        [document.broker?.name, document.broker?.creci].filter(Boolean).join(" · ") ||
        document.organization.name,
    },
  ])

  drawSectionTitle(layout, "Assinaturas")
  drawParagraph(
    layout,
    "Ao assinar, o proponente confirma os valores e as condições acima. A proposta só vincula as partes depois do aceite do proprietário.",
    { size: 8.5, color: MUTED }
  )
  drawSignatures(layout, document)

  drawFooters(layout, document)

  const saved = await doc.save()
  const reference = document.property?.code ?? document.proposal.id.slice(0, 8)

  return {
    bytes: new Uint8Array(saved),
    fileName: `proposta-${slugifyFileName(reference)}.pdf`,
  }
}

function slugifyFileName(value: string) {
  const slug = value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")

  return slug || "proposta"
}

/** PNG ou JPEG; imagem inválida vira `null` em vez de derrubar o PDF. */
async function embedLogo(doc: PDFDocument, bytes: Uint8Array | null) {
  if (!bytes || bytes.length === 0) {
    return null
  }

  try {
    const isPng = bytes[0] === 0x89 && bytes[1] === 0x50
    return isPng ? await doc.embedPng(bytes) : await doc.embedJpg(bytes)
  } catch {
    return null
  }
}

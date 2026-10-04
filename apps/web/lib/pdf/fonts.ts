import "server-only"

// Fontes dos PDFs gerados no servidor (proposta e ficha do imóvel): Geist, a
// mesma fonte do app, embutida com subconjunto (só os glifos usados entram no
// arquivo). Os .ttf vêm do pacote `geist` já instalado (SIL Open Font License
// 1.1, que permite embutir a fonte em documentos) e são lidos uma vez por
// instância da função. Se a leitura ou o embutimento falhar, o PDF sai com a
// Helvetica padrão: a geração nunca quebra por causa da fonte.
//
// Caminho relativo ao diretório do app (apps/web), que é o `process.cwd()` do
// `next dev`/`next start` e da função na Vercel; o pacote fica no node_modules
// da raiz do monorepo. Os caminhos são literais de propósito: assim o build
// (Turbopack) rastreia só esses dois arquivos e os leva para a função das rotas
// de PDF, sem precisar de outputFileTracingIncludes no next.config.ts.

import { readFile } from "node:fs/promises"
import path from "node:path"

import fontkit from "@pdf-lib/fontkit"
import { StandardFonts, type PDFDocument, type PDFFont } from "pdf-lib"

import { supportedByAll, type SupportsCodePoint } from "@workspace/core/proposals/pdf-text"

export type PdfFonts = {
  regular: PDFFont
  /** Peso dos títulos e valores: SemiBold, como `font-semibold` nos títulos do app. */
  semiBold: PDFFont
  /** O que as duas fontes desenham; todo texto passa por `toPdfText` com isto. */
  supports: SupportsCodePoint
}

type GeistFiles = { regular: Uint8Array; semiBold: Uint8Array }

let geistFiles: Promise<GeistFiles> | null = null

function loadGeistFiles() {
  geistFiles ??= Promise.all([
    readFile(
      path.join(process.cwd(), "../../node_modules/geist/dist/fonts/geist-sans/Geist-Regular.ttf")
    ),
    readFile(
      path.join(process.cwd(), "../../node_modules/geist/dist/fonts/geist-sans/Geist-SemiBold.ttf")
    ),
  ]).then(
    // Cópia com ArrayBuffer próprio (o Buffer do Node pode ser uma fatia de outro).
    ([regular, semiBold]) => ({
      regular: new Uint8Array(regular),
      semiBold: new Uint8Array(semiBold),
    }),
    (error: unknown) => {
      // Sem cache da falha: a próxima geração tenta ler de novo.
      geistFiles = null
      throw error
    }
  )

  return geistFiles
}

function errorCode(error: unknown) {
  if (error && typeof error === "object" && "code" in error && typeof error.code === "string") {
    return error.code
  }

  return error instanceof Error ? error.name : "erro"
}

async function embedStandardFonts(doc: PDFDocument): Promise<PdfFonts> {
  const [regular, semiBold] = await Promise.all([
    doc.embedFont(StandardFonts.Helvetica),
    doc.embedFont(StandardFonts.HelveticaBold),
  ])

  return {
    regular,
    semiBold,
    supports: supportedByAll(regular.getCharacterSet(), semiBold.getCharacterSet()),
  }
}

/** Embute a Geist (Regular e SemiBold) no documento; cai na Helvetica se não der. */
export async function embedPdfFonts(doc: PDFDocument): Promise<PdfFonts> {
  try {
    const files = await loadGeistFiles()

    doc.registerFontkit(fontkit)

    const [regular, semiBold] = await Promise.all([
      doc.embedFont(files.regular, { subset: true }),
      doc.embedFont(files.semiBold, { subset: true }),
    ])

    return {
      regular,
      semiBold,
      supports: supportedByAll(regular.getCharacterSet(), semiBold.getCharacterSet()),
    }
  } catch (error) {
    // Só o código: nada do conteúdo do documento vai para o log.
    console.error("[pdf] Geist indisponível, PDF com a fonte padrão:", errorCode(error))
    return embedStandardFonts(doc)
  }
}

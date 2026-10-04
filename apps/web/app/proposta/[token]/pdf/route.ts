import { renderProposalPdf } from "@/lib/propostas/pdf"
import { fetchBrandLogo, getSharedProposalDocument } from "@/lib/propostas/share"

/**
 * PDF da proposta pelo link público: /proposta/{token}/pdf.
 *
 * Rota pública e sem sessão, com o mesmo documento da página. O CPF/CNPJ do
 * proponente vem mascarado do banco. Token errado, revogado ou vencido: 404,
 * sem distinguir os casos.
 */

export const dynamic = "force-dynamic"

const NOT_FOUND_HEADERS = {
  "Cache-Control": "no-store",
  "X-Robots-Tag": "noindex, nofollow",
}

export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const document = await getSharedProposalDocument(token)

  if (!document) {
    return new Response(null, { status: 404, headers: NOT_FOUND_HEADERS })
  }

  const logo = await fetchBrandLogo(document.organization.brand.logoUrl)
  const { bytes, fileName } = await renderProposalPdf(document, logo)

  return new Response(bytes, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${fileName}"`,
      // O endereço carrega o token: nenhum proxy ou CDN guarda a resposta.
      "Cache-Control": "private, no-store",
      "X-Robots-Tag": "noindex, nofollow",
      "Referrer-Policy": "no-referrer",
    },
  })
}

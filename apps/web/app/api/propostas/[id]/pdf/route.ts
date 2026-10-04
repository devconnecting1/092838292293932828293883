import { z } from "zod"

import { requireMembership } from "@/lib/auth/session"
import { renderProposalPdf } from "@/lib/propostas/pdf"
import { fetchBrandLogo, getProposalDocument } from "@/lib/propostas/share"
import { createClient } from "@/lib/supabase/server"

/**
 * PDF da proposta para a equipe: /api/propostas/{id}/pdf.
 *
 * Documento completo (com o CPF/CNPJ do proponente), gerado no servidor com
 * pdf-lib. Exige sessão; quem decide o acesso é a RPC get_proposal_document,
 * que devolve null para proposta de outra imobiliária — a resposta é 404 nos
 * dois casos, sem distinguir.
 */

const NOT_FOUND_HEADERS = {
  "Cache-Control": "no-store",
  "X-Robots-Tag": "noindex",
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  await requireMembership()

  const { id } = await params

  if (!z.guid().safeParse(id).success) {
    return new Response(null, { status: 404, headers: NOT_FOUND_HEADERS })
  }

  const supabase = await createClient()
  const document = await getProposalDocument(supabase, id)

  if (!document) {
    return new Response(null, { status: 404, headers: NOT_FOUND_HEADERS })
  }

  const logo = await fetchBrandLogo(document.organization.brand.logoUrl)
  const { bytes, fileName } = await renderProposalPdf(document, logo)

  return new Response(bytes, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${fileName}"`,
      // Documento com dados pessoais: nenhum proxy ou CDN guarda a resposta.
      "Cache-Control": "private, no-store",
      "X-Robots-Tag": "noindex",
    },
  })
}

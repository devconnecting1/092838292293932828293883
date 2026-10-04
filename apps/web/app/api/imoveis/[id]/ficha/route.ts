import { requireMembership } from "@/lib/auth/session"
import { fetchPropertySheetPhotos, getPropertySheetDocument } from "@/lib/imoveis/ficha-document"
import { renderPropertySheetPdf } from "@/lib/imoveis/ficha-pdf"
import { isUuid } from "@/lib/imoveis/ids"
import { fetchBrandLogo } from "@/lib/propostas/share"
import { createClient } from "@/lib/supabase/server"

/**
 * Ficha do imóvel em PDF A4 para imprimir ou enviar: /api/imoveis/{id}/ficha.
 *
 * Exige sessão. Quem decide o acesso é o RLS (a leitura usa a sessão de quem
 * pediu): imóvel de outra imobiliária ou que a pessoa não vê responde 404, sem
 * distinguir os casos. O endereço segue o modo de exibição do imóvel e nada do
 * proprietário entra no documento.
 *
 * Por padrão vai como download (`attachment`, igual ao PDF da proposta). Com
 * `?abrir=1` vai `inline` e abre na aba: esta rota tem CSP própria em
 * next.config.ts, que troca só `object-src` para 'self' (o resto do app segue com
 * `object-src 'none'`). É o que o botão "Imprimir ficha" usa.
 */

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const NOT_FOUND_HEADERS = {
  "Cache-Control": "no-store",
  "X-Robots-Tag": "noindex",
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const [{ id }, { user, membership }] = await Promise.all([params, requireMembership()])

  if (!isUuid(id)) {
    return new Response(null, { status: 404, headers: NOT_FOUND_HEADERS })
  }

  const supabase = await createClient()
  let sheet: Awaited<ReturnType<typeof getPropertySheetDocument>>

  try {
    sheet = await getPropertySheetDocument(supabase, membership.organizationId, id, user.id)
  } catch (error) {
    // Só o tipo: a mensagem pode trazer dados do imóvel.
    console.error(
      `[imoveis/ficha] falha ao carregar a ficha (${error instanceof Error ? error.name : "erro"})`
    )
    return new Response(null, { status: 500, headers: NOT_FOUND_HEADERS })
  }

  if (!sheet) {
    return new Response(null, { status: 404, headers: NOT_FOUND_HEADERS })
  }

  const [photos, logo] = await Promise.all([
    fetchPropertySheetPhotos(sheet.photoPaths),
    fetchBrandLogo(sheet.organization.brand.logoUrl),
  ])
  const { bytes, fileName } = await renderPropertySheetPdf(sheet, photos, logo)
  const inline = new URL(request.url).searchParams.get("abrir") === "1"

  return new Response(bytes, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${fileName}"`,
      // Documento da equipe: nenhum proxy ou CDN guarda a resposta.
      "Cache-Control": "private, no-store",
      "X-Robots-Tag": "noindex",
    },
  })
}

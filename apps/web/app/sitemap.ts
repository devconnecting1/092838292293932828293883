import type { MetadataRoute } from "next"
import { headers } from "next/headers"

import { buildPublicPropertyUrl } from "@/lib/imovel-publico/urls"
import { getPublicSitemap } from "@/lib/imovel-publico/queries"
import { buildLandingPageUrl, classifyRequestHost } from "@/lib/tenant/urls"

/**
 * sitemap.xml por subdomínio ({slug}.raiz/sitemap.xml): páginas públicas dos
 * imóveis ativos e as landing pages publicadas da imobiliária. O Host só
 * escolhe a imobiliária (slug validado pelo core); as URLs saem da configuração
 * do app, nunca do Host. Domínio raiz, host único e subdomínio desconhecido
 * respondem um sitemap vazio (o CRM não é indexado).
 *
 * Lê o Host, então é gerado a cada pedido (buscadores leem o sitemap poucas
 * vezes por dia; a consulta é uma RPC com índice).
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const tenancy = classifyRequestHost((await headers()).get("host"))

  if (tenancy.kind !== "tenant") {
    return []
  }

  const { properties, landingPages } = await getPublicSitemap(tenancy.slug)
  const entries: MetadataRoute.Sitemap = []

  for (const property of properties) {
    try {
      entries.push({
        url: buildPublicPropertyUrl(tenancy.slug, property.code),
        lastModified: property.updatedAt ?? undefined,
        changeFrequency: "weekly",
      })
    } catch {
      // Código fora do formato de endereço: fica fora do sitemap.
    }
  }

  for (const page of landingPages) {
    entries.push({
      url: buildLandingPageUrl(tenancy.slug, page.slug),
      lastModified: page.updatedAt ?? undefined,
      changeFrequency: "weekly",
    })
  }

  return entries
}

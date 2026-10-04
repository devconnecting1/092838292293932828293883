import type { MetadataRoute } from "next"
import { headers } from "next/headers"

import { buildTenantUrl, classifyRequestHost } from "@/lib/tenant/urls"

/**
 * robots.txt servido pelo próprio app (sem ele, /robots.txt caía no 404 em HTML).
 * Rotas de API, autenticação, convites e links de proposta não são indexadas;
 * o CRM já exige login. No subdomínio da imobiliária aponta o sitemap.xml dela
 * (imóveis ativos e landing page publicada); a URL sai da configuração do app
 * e do slug validado, nunca do Host.
 */
export default async function robots(): Promise<MetadataRoute.Robots> {
  const rules: MetadataRoute.Robots["rules"] = {
    userAgent: "*",
    allow: "/",
    disallow: ["/api/", "/auth/", "/convite/", "/proposta/", "/onboarding", "/imobiliarias"],
  }

  const tenancy = classifyRequestHost((await headers()).get("host"))

  if (tenancy.kind !== "tenant") {
    return { rules }
  }

  return { rules, sitemap: buildTenantUrl(tenancy.slug, "/sitemap.xml") }
}

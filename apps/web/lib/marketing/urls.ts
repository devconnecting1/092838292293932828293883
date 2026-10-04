import { buildLandingPageUrl, buildTenantUrl } from "@/lib/tenant/urls"

/*
 * Endereços das landing pages (multi-tenant por subdomínio):
 *   público: {slug-da-imobiliária}.{raiz}/lp/{slug-da-página}
 * O proxy reescreve esse endereço para a rota interna /lp/[org]/[page].
 */

/**
 * Caminho da rota interna (`/lp/[org]/[page]`). Use só em `revalidatePath`,
 * que trabalha com o destino do rewrite, nunca para exibir ou linkar.
 */
export function buildLandingPublicPath(organizationSlug: string, pageSlug: string) {
  return `/lp/${encodeURIComponent(organizationSlug)}/${encodeURIComponent(pageSlug)}`
}

/** URL pública no subdomínio da imobiliária; null se o slug não servir de subdomínio. */
export function getLandingPublicUrl(organizationSlug: string, pageSlug: string): string | null {
  try {
    return buildLandingPageUrl(organizationSlug, pageSlug)
  } catch {
    return null
  }
}

/** Prefixo exibido no campo de endereço, ex.: "teste.localhost:3000/lp/". */
/**
 * Link da landing que já marca a origem do lead (?origem=instagram para a bio,
 * ?origem=whatsapp para mensagens), com os UTMs do canal para o relatório de
 * origem. A origem é validada de novo no envio e no banco.
 */
export function withLandingLeadOrigin(publicUrl: string, origin: "instagram" | "whatsapp"): string {
  try {
    const url = new URL(publicUrl)
    url.searchParams.set("origem", origin)
    url.searchParams.set("utm_source", origin)
    url.searchParams.set("utm_medium", origin === "instagram" ? "bio" : "mensagem")
    return url.toString()
  } catch {
    return publicUrl
  }
}

export function getLandingPublicUrlPrefix(organizationSlug: string): string | null {
  try {
    return displayUrl(buildTenantUrl(organizationSlug, "/lp/"))
  } catch {
    return null
  }
}

/** Exibição sem protocolo (ex.: prévia de resultado de busca). */
export function displayUrl(url: string) {
  return url.replace(/^https?:\/\//, "")
}

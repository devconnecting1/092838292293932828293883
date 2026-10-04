import "server-only"

import { getAppOrigin } from "@/lib/tenant/urls"

/**
 * Origem pública do domínio raiz (sem barra final).
 *
 * Com o multi-tenant por subdomínio, links de e-mail, de convite e das páginas
 * públicas usam as funções de lib/tenant/urls.ts (env + slug validado) e os
 * redirecionamentos de /auth usam getCurrentOrigin (lib/tenant/server.ts).
 * Esta função fica por compatibilidade: devolve NEXT_PUBLIC_SITE_URL, se
 * definida, ou a origem de NEXT_PUBLIC_ROOT_DOMAIN.
 *
 * Nunca vem dos headers da requisição (Origin, Host, X-Forwarded-Host): eles
 * podem ser forjados para fazer um link de recuperação apontar para o domínio
 * de um atacante.
 */
export function getSiteUrl(): string {
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.trim()

  if (configured) {
    return parseSiteUrl(configured)
  }

  return getAppOrigin()
}

function parseSiteUrl(value: string) {
  let url: URL

  try {
    url = new URL(value)
  } catch {
    throw new Error(
      "NEXT_PUBLIC_SITE_URL é inválida. Use uma URL absoluta, como https://seucrm.com.br."
    )
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("NEXT_PUBLIC_SITE_URL precisa começar com https:// ou http://.")
  }

  // `origin` nunca tem barra final, caminho ou query.
  return url.origin
}

/**
 * URL de /auth/callback numa origem já validada (getCurrentOrigin). A URL
 * precisa casar com as "Redirect URLs" do Supabase; caso contrário ele usa o
 * Site URL do projeto.
 */
export function buildAuthCallbackUrl(
  origin: string,
  next: string,
  extraParams: Record<string, string> = {}
) {
  const url = new URL("/auth/callback", origin)
  url.searchParams.set("next", next)

  for (const [key, value] of Object.entries(extraParams)) {
    url.searchParams.set(key, value)
  }

  return url.toString()
}

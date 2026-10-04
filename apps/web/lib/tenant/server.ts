import "server-only"

import { headers } from "next/headers"
import { cache } from "react"

import { HOME_PATH, TENANT_PICKER_PATH } from "@/lib/auth/routes"
import { TENANT_SLUG_HEADER } from "@/lib/tenant/headers"
import {
  buildTenantOrigin,
  getAppOrigin,
  isSubdomainTenancy,
  isValidTenantSlug,
  parseTenantSlugFromHost,
} from "@/lib/tenant/urls"

/**
 * Slug da imobiliária do subdomínio da requisição, lido do header definido
 * pelo proxy (que já conferiu que a imobiliária existe). `null` no domínio
 * raiz e no modo single-host (lá a imobiliária vem do cookie; ver session.ts).
 *
 * O host só escolhe o tenant: a autorização continua em requireMembership
 * (membership ativa) e no RLS. Por defesa, o header só vale quando bate com o
 * Host; assim uma rota fora do matcher do proxy não aceita um valor forjado.
 */
export const getCurrentTenantSlug = cache(async (): Promise<string | null> => {
  if (!isSubdomainTenancy()) {
    return null
  }

  const headerList = await headers()
  const fromProxy = headerList.get(TENANT_SLUG_HEADER)

  if (!fromProxy || !isValidTenantSlug(fromProxy)) {
    return null
  }

  return parseTenantSlugFromHost(headerList.get("host")) === fromProxy ? fromProxy : null
})

/**
 * Origem canônica do host atual para links de e-mail e redirecionamentos:
 * subdomínio validado da imobiliária ou domínio raiz (modo subdomain), ou
 * NEXT_PUBLIC_SITE_URL (single-host). Sempre env + slug, nunca headers.
 */
export async function getCurrentOrigin(): Promise<string> {
  const slug = await getCurrentTenantSlug()
  return slug ? buildTenantOrigin(slug) : getAppOrigin()
}

/**
 * Destino padrão depois do login: o painel no subdomínio e no host único; a
 * escolha de imobiliária no domínio raiz.
 */
export async function getDefaultRedirectPath(): Promise<string> {
  if (!isSubdomainTenancy()) {
    return HOME_PATH
  }

  return (await getCurrentTenantSlug()) ? HOME_PATH : TENANT_PICKER_PATH
}

import { STATUS_PAGE_PATH } from "@/lib/auth/routes"
import { buildAppUrl, isSubdomainTenancy } from "@/lib/tenant/urls"

/** Página de status pública (domínio raiz, sem login): definida em lib/auth/routes.ts. */
export { STATUS_PAGE_PATH }

/** JSON público com o mesmo formato de PublicStatusSnapshot. */
export const STATUS_API_PATH = "/api/status"

/** Feed RSS dos incidentes e manutenções. */
export const STATUS_FEED_PATH = "/status/feed.xml"

/**
 * Link para a página de status a partir de qualquer tela. No modo subdomain o
 * CRM está no subdomínio da imobiliária e a página fica no domínio raiz, então
 * o link é absoluto; no host único é relativo (não troca de host em deploys de
 * preview). Funciona no servidor e no navegador (as NEXT_PUBLIC_* são inlinadas).
 */
export function getStatusPageHref() {
  return isSubdomainTenancy() ? buildAppUrl(STATUS_PAGE_PATH) : STATUS_PAGE_PATH
}

/**
 * URL absoluta no domínio raiz (ou no host único) a partir da configuração do
 * app, nunca do Host da requisição. null quando o host único não tem
 * NEXT_PUBLIC_SITE_URL (quem chama decide o que omitir).
 */
export function tryBuildStatusUrl(path: string) {
  try {
    return buildAppUrl(path)
  } catch {
    return null
  }
}

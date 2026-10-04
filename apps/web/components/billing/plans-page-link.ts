// Endereço de /planos a partir do CRM. Puro: servidor e navegador usam.
import { PLANS_ORGANIZATION_PARAM, PLANS_PATH } from "@/lib/auth/routes"
import { buildAppUrl, isSubdomainTenancy, isValidTenantSlug } from "@/lib/tenant/urls"

/**
 * /planos fica fora do painel, no domínio raiz. No host único o caminho basta
 * (a imobiliária é a do cookie validado). No modo subdomain vai para a raiz com
 * o slug da imobiliária, que a página confere contra as memberships ativas.
 */
export function plansPageHref(organizationSlug?: string | null): string {
  if (!isSubdomainTenancy()) {
    return PLANS_PATH
  }

  const query =
    organizationSlug && isValidTenantSlug(organizationSlug)
      ? `?${new URLSearchParams({ [PLANS_ORGANIZATION_PARAM]: organizationSlug }).toString()}`
      : ""

  return buildAppUrl(`${PLANS_PATH}${query}`)
}

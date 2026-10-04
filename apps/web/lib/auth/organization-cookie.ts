/**
 * Cookie com a imobiliária escolhida no modo de host único
 * (NEXT_PUBLIC_TENANCY_MODE=single-host). É só uma preferência: o servidor
 * sempre valida o valor contra as memberships ativas do usuário, e o RLS do
 * banco continua sendo a barreira final. No modo subdomain não é usado: a
 * imobiliária vem do subdomínio.
 */
export const ORGANIZATION_COOKIE_NAME = "crm_org"

export const ORGANIZATION_COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: "lax",
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge: 60 * 60 * 24 * 365,
} as const

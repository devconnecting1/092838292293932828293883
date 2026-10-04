/**
 * Header interno com o slug da imobiliária do subdomínio. Só o proxy define:
 * ele remove qualquer valor vindo do cliente antes de gravar o seu. O servidor
 * ainda confere o valor contra o Host (ver lib/tenant/server.ts).
 */
export const TENANT_SLUG_HEADER = "x-tenant-slug"

/**
 * Headers internos do redirecionamento para o domínio raiz (caminho relativo
 * e status 307/308), lidos por app/imobiliarias/redirecionar-raiz/route.ts.
 * Route handlers veem a URL original mesmo depois de um rewrite, então os
 * valores vão por header. O proxy também remove os valores vindos do cliente.
 */
export const ROOT_REDIRECT_PATH_HEADER = "x-root-redirect-path"
export const ROOT_REDIRECT_STATUS_HEADER = "x-root-redirect-status"

/** Todos os headers internos que o proxy descarta quando vêm do cliente. */
export const INTERNAL_PROXY_HEADERS = [
  TENANT_SLUG_HEADER,
  ROOT_REDIRECT_PATH_HEADER,
  ROOT_REDIRECT_STATUS_HEADER,
] as const

// Rotas internas do multi-tenant por subdomínio. As decisões puras de
// caminho (rewrites das URLs curtas e redirects das URLs longas) ficam em
// @workspace/core/tenant/paths, com testes.
//
//   {slug}.raiz/sem-acesso  → /imobiliarias/sem-acesso
//   subdomínio desconhecido → /imobiliarias/nao-encontrada (404)

export {
  getLegacyPublicRedirect,
  getTenantPublicRewrite,
  type LegacyPublicRedirect,
} from "@workspace/core/tenant/paths"

/** Rota interna da tela "Você não tem acesso a esta imobiliária". */
export const TENANT_ACCESS_DENIED_INTERNAL_PATH = "/imobiliarias/sem-acesso"

/** Rota interna do 404 "Imobiliária não encontrada". */
export const TENANT_NOT_FOUND_INTERNAL_PATH = "/imobiliarias/nao-encontrada"

/**
 * Route handler que redireciona para o domínio raiz (www e rotas só da raiz
 * num subdomínio). Ver app/imobiliarias/redirecionar-raiz/route.ts.
 */
export const ROOT_REDIRECT_INTERNAL_PATH = "/imobiliarias/redirecionar-raiz"

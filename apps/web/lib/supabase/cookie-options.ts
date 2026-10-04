// Opções dos cookies de sessão do Supabase Auth. Sem `server-only`: o proxy e
// o servidor (Server Components, Server Actions e Route Handlers) usam a mesma
// regra. O navegador não usa mais cliente Supabase com sessão.

import type { CookieOptionsWithName } from "@supabase/ssr"

import { classifyHost, getSharedCookieDomain } from "@workspace/core/tenant/host"

import { tryGetRootDomain } from "@/lib/tenant/urls"

/**
 * Cookies de sessão fora do alcance do JavaScript da página:
 * - HttpOnly: um XSS não consegue ler o access/refresh token. Só funciona
 *   porque nenhum código do navegador usa a sessão do Supabase (uploads usam
 *   URL assinada gerada no servidor; login, renovação e saída são no servidor);
 * - Secure em produção (em `next dev` o http://localhost precisa do cookie);
 * - SameSite=Lax: o link mágico e a volta do checkout continuam logados.
 * O @supabase/ssr mescla estas opções sobre as padrão e mantém o Max-Age de
 * 400 dias; a validade real é a do refresh token no Supabase Auth.
 */
const SESSION_COOKIE_SECURITY = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax",
  path: "/",
} as const satisfies CookieOptionsWithName

/**
 * Em produção, grava os cookies com Domain=.raiz (ex.: ".seucrm.com.br") para a
 * sessão valer na raiz e em todos os subdomínios: o usuário circula entre as
 * suas imobiliárias sem entrar de novo.
 *
 * Fica host-only (sem Domain) quando:
 * - a raiz é localhost/IP: o navegador não compartilha cookie entre `*.localhost`;
 * - o host atual não pertence à raiz (ex.: URL de preview): o navegador
 *   recusaria um cookie com Domain de outro site.
 */
export function getSessionCookieOptions(host: string | null | undefined): CookieOptionsWithName {
  const root = tryGetRootDomain()
  const domain = root ? getSharedCookieDomain(root) : null

  if (!root || !domain || classifyHost(host, root).kind === "external") {
    return { ...SESSION_COOKIE_SECURITY }
  }

  return { ...SESSION_COOKIE_SECURITY, domain }
}

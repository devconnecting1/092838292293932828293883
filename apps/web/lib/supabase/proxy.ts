import { createServerClient } from "@supabase/ssr"
import { NextResponse, type NextRequest } from "next/server"

import { PUBLIC_PROPERTY_PATH_PREFIX } from "@workspace/core/tenant/public-property"
import type { Database } from "@workspace/database/types"

import {
  ACCESS_DENIED_PATH,
  HOME_PATH,
  isCronPath,
  isGuestOnlyPath,
  isPublicPath,
  isRootHostPath,
  isRootOnlyPath,
  isWebhookPath,
  LOGIN_PATH,
  PLANS_ACCOUNT_INTERNAL_PATH,
  PLANS_PATH,
  PROPOSAL_SHARE_PATH_PREFIX,
  sanitizeRedirectPath,
  TENANT_PICKER_PATH,
  WEBHOOKS_PATH_PREFIX,
} from "@/lib/auth/routes"
import { getSessionCookieOptions } from "@/lib/supabase/cookie-options"
import { getSupabaseEnv } from "@/lib/supabase/env"
import {
  INTERNAL_PROXY_HEADERS,
  ROOT_REDIRECT_PATH_HEADER,
  ROOT_REDIRECT_STATUS_HEADER,
  TENANT_SLUG_HEADER,
} from "@/lib/tenant/headers"
import { tenantExists } from "@/lib/tenant/lookup"
import {
  getLegacyPublicRedirect,
  getTenantPublicRewrite,
  ROOT_REDIRECT_INTERNAL_PATH,
  TENANT_ACCESS_DENIED_INTERNAL_PATH,
  TENANT_NOT_FOUND_INTERNAL_PATH,
} from "@/lib/tenant/routing"
import {
  buildTenantOrigin,
  buildTenantUrl,
  classifyRequestHost,
  getAppOrigin,
  isValidTenantSlug,
} from "@/lib/tenant/urls"

/**
 * Rotas públicas que nunca usam a sessão: landing pages, páginas dos imóveis,
 * feed dos portais, link da proposta e webhooks (URLs curtas do subdomínio e
 * rotas longas têm o mesmo prefixo). Pular a renovação evita uma chamada ao
 * Auth por visita e Set-Cookie que impediria o cache dessas respostas.
 */
const SESSIONLESS_PREFIXES = [
  "/lp",
  PUBLIC_PROPERTY_PATH_PREFIX,
  "/api/feeds",
  PROPOSAL_SHARE_PATH_PREFIX,
  WEBHOOKS_PATH_PREFIX,
  // Página de status e seu JSON: públicos e em cache de CDN (sem Set-Cookie de sessão).
  "/status",
  "/api/status",
]

function isSessionlessPath(pathname: string) {
  return SESSIONLESS_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  )
}

function normalizePathname(pathname: string) {
  return pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname
}

type RouteContext = {
  /**
   * - tenant: subdomínio de imobiliária existente (modo subdomain);
   * - root: domínio raiz ou host fora da raiz (modo subdomain);
   * - single-host: host único (a imobiliária vem do cookie, no servidor).
   */
  hostKind: "tenant" | "root" | "single-host"
  /** Slug do subdomínio (formato validado e imobiliária existente). */
  tenantSlug: string | null
  /** Origem para os redirecionamentos no mesmo host. */
  origin: string
  /** Rota interna para rewrite (ex.: /captar/teste); null mantém o caminho. */
  rewritePath: string | null
}

/**
 * Headers repassados ao app. Remove os headers internos vindos do cliente
 * (x-tenant-slug e os do redirecionamento para a raiz) antes de gravar os do
 * proxy. Montado na hora: a renovação da sessão atualiza o header Cookie.
 */
function forwardedHeaders(request: NextRequest, tenantSlug: string | null) {
  const headers = new Headers(request.headers)

  for (const name of INTERNAL_PROXY_HEADERS) {
    headers.delete(name)
  }

  if (tenantSlug) {
    headers.set(TENANT_SLUG_HEADER, tenantSlug)
  }

  return headers
}

function continueRequest(request: NextRequest, context: RouteContext) {
  const init = {
    request: { headers: forwardedHeaders(request, context.tenantSlug) },
  }

  if (!context.rewritePath) {
    return NextResponse.next(init)
  }

  const url = request.nextUrl.clone()
  url.pathname = context.rewritePath

  return NextResponse.rewrite(url, init)
}

/**
 * Redireciona para o mesmo caminho no domínio raiz. Vai por um route handler
 * (rewrite) porque o servidor Node do Next torna relativo o Location de proxy
 * com a origem dele; em dev essa origem é a própria raiz (localhost:3000).
 * Caminho e status seguem por headers internos: route handlers enxergam a URL
 * original, não a query do rewrite.
 */
function redirectToRootHost(request: NextRequest, status: 307 | 308) {
  const { pathname, search } = request.nextUrl
  const url = request.nextUrl.clone()
  url.pathname = ROOT_REDIRECT_INTERNAL_PATH
  url.search = ""

  const headers = forwardedHeaders(request, null)
  headers.set(ROOT_REDIRECT_PATH_HEADER, `${pathname}${search}`)
  headers.set(ROOT_REDIRECT_STATUS_HEADER, String(status))

  return NextResponse.rewrite(url, { request: { headers } })
}

/** 404 "Imobiliária não encontrada", sem revelar dados. */
function rewriteToTenantNotFound(request: NextRequest) {
  const url = request.nextUrl.clone()
  url.pathname = TENANT_NOT_FOUND_INTERNAL_PATH
  url.search = ""

  return NextResponse.rewrite(url, {
    request: { headers: forwardedHeaders(request, null) },
  })
}

/** Copia para `response` os cookies e headers da renovação da sessão. */
function withSessionState(
  response: NextResponse,
  sessionResponse: NextResponse,
  sessionHeaders: Record<string, string>
) {
  for (const cookie of sessionResponse.cookies.getAll()) {
    response.cookies.set(cookie)
  }

  for (const [key, value] of Object.entries(sessionHeaders)) {
    response.headers.set(key, value)
  }

  return response
}

function redirectWithSession(
  url: URL,
  sessionResponse: NextResponse,
  sessionHeaders: Record<string, string>
) {
  return withSessionState(NextResponse.redirect(url), sessionResponse, sessionHeaders)
}

/**
 * Resolve o tenant pelo Host (modo subdomain), aplica rewrites/redirects, renova
 * a sessão do Supabase e faz o redirecionamento otimista de autenticação.
 * A autorização de verdade (membership ativa, papel) acontece nos layouts,
 * páginas e Server Actions, e no RLS do banco: o host só escolhe o tenant.
 */
export async function updateSession(request: NextRequest) {
  // Webhooks (ex.: Stripe) e tarefas agendadas (Vercel Cron): públicos e sem
  // sessão em qualquer host, sem resolver tenant nem redirecionar. Headers
  // internos forjados são removidos.
  if (isWebhookPath(request.nextUrl.pathname) || isCronPath(request.nextUrl.pathname)) {
    return NextResponse.next({ request: { headers: forwardedHeaders(request, null) } })
  }

  const tenancy = classifyRequestHost(request.headers.get("host"))

  switch (tenancy.kind) {
    case "single-host":
      // Host único: rotas longas atendem direto, sem rewrites nem redirects de
      // tenant. O header forjado é descartado do mesmo jeito.
      return withSession(request, {
        hostKind: "single-host",
        tenantSlug: null,
        origin: request.nextUrl.origin,
        rewritePath: null,
      })
    case "www":
      // www.raiz é apelido da raiz: uma única origem para sessão e SEO.
      return redirectToRootHost(request, 308)
    case "invalid-tenant":
      return rewriteToTenantNotFound(request)
    case "tenant":
      return handleTenantHost(request, tenancy.slug)
    case "root":
      return handleRootHost(request, getAppOrigin())
    default:
      // Host fora da raiz (IP em dev, URL de preview do provedor): comportamento
      // da raiz, redirecionando no próprio host.
      return handleRootHost(request, request.nextUrl.origin)
  }
}

async function handleTenantHost(request: NextRequest, slug: string) {
  const { pathname } = request.nextUrl

  // Onboarding e escolha de imobiliária ficam só na raiz.
  if (isRootOnlyPath(pathname)) {
    return redirectToRootHost(request, 307)
  }

  const publicRewrite = getTenantPublicRewrite(pathname, slug)

  // Páginas públicas resolvem a imobiliária sozinhas (404 se não existir);
  // o restante confere a existência antes de pedir login.
  if (!publicRewrite && !(await tenantExists(slug))) {
    return rewriteToTenantNotFound(request)
  }

  const rewritePath =
    publicRewrite ??
    (normalizePathname(pathname) === ACCESS_DENIED_PATH ? TENANT_ACCESS_DENIED_INTERNAL_PATH : null)

  return withSession(request, {
    hostKind: "tenant",
    tenantSlug: slug,
    origin: buildTenantOrigin(slug),
    rewritePath,
  })
}

function handleRootHost(request: NextRequest, origin: string) {
  const { pathname, search } = request.nextUrl
  const legacy = getLegacyPublicRedirect(pathname)

  if (legacy) {
    if (!isValidTenantSlug(legacy.slug)) {
      return rewriteToTenantNotFound(request)
    }

    // Rotas longas de landing page e captação: 308 preserva método e query (UTMs).
    return NextResponse.redirect(`${buildTenantUrl(legacy.slug, legacy.path)}${search}`, 308)
  }

  return withSession(request, {
    hostKind: "root",
    tenantSlug: null,
    origin,
    rewritePath: null,
  })
}

async function withSession(request: NextRequest, context: RouteContext) {
  const env = getSupabaseEnv()
  const { pathname, search } = request.nextUrl

  // Sem variáveis: deixa passar. As páginas mostram a tela "Configure o Supabase".
  if (!env || isSessionlessPath(pathname)) {
    return continueRequest(request, context)
  }

  let response = continueRequest(request, context)
  let sessionHeaders: Record<string, string> = {}

  const supabase = createServerClient<Database>(env.url, env.publishableKey, {
    cookieOptions: getSessionCookieOptions(request.headers.get("host")),
    cookies: {
      getAll() {
        return request.cookies.getAll()
      },
      setAll(cookiesToSet, headers) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value)
        }

        response = continueRequest(request, context)

        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options)
        }

        sessionHeaders = { ...sessionHeaders, ...headers }

        for (const [key, value] of Object.entries(headers)) {
          response.headers.set(key, value)
        }
      },
    },
  })

  // Importante: nada entre createServerClient e getClaims. getClaims valida o
  // JWT e dispara a renovação do token quando ele está perto de expirar.
  let isAuthenticated: boolean

  try {
    const { data } = await supabase.auth.getClaims()
    isAuthenticated = Boolean(data?.claims?.sub)
  } catch {
    isAuthenticated = false
  }

  if (!isAuthenticated && !isPublicPath(pathname)) {
    // Visitante na raiz: o login aparece no próprio "/" (rewrite), sem o
    // redirecionamento extra que custava ~0,8 s no celular (PageSpeed).
    if (normalizePathname(pathname) === "/") {
      const rewriteUrl = request.nextUrl.clone()
      rewriteUrl.pathname = LOGIN_PATH

      return withSessionState(
        NextResponse.rewrite(rewriteUrl, {
          request: { headers: forwardedHeaders(request, context.tenantSlug) },
        }),
        response,
        sessionHeaders
      )
    }

    const loginUrl = new URL(LOGIN_PATH, context.origin)

    if (pathname !== "/") {
      loginUrl.searchParams.set("next", `${pathname}${search}`)
    }

    return redirectWithSession(loginUrl, response, sessionHeaders)
  }

  const isRootHost = context.hostKind === "root"
  const homePath = isRootHost ? TENANT_PICKER_PATH : HOME_PATH

  if (isAuthenticated && isGuestOnlyPath(pathname)) {
    const destination = sanitizeRedirectPath(request.nextUrl.searchParams.get("next"), homePath)

    return redirectWithSession(new URL(destination, context.origin), response, sessionHeaders)
  }

  // Planos: visitante recebe a página estática (ISR); quem entrou, a versão da
  // conta (dinâmica), no mesmo endereço e sem piscar. A página confere a sessão
  // e as memberships de novo: aqui só se escolhe qual versão renderizar.
  if (isAuthenticated && normalizePathname(pathname) === PLANS_PATH) {
    const accountUrl = request.nextUrl.clone()
    accountUrl.pathname = PLANS_ACCOUNT_INTERNAL_PATH

    return withSessionState(
      NextResponse.rewrite(accountUrl, {
        request: { headers: forwardedHeaders(request, context.tenantSlug) },
      }),
      response,
      sessionHeaders
    )
  }

  // CRM no domínio raiz (modo subdomain): escolher a imobiliária (ou ir direto à única).
  if (isAuthenticated && isRootHost && !isRootHostPath(pathname)) {
    const pickerUrl = new URL(TENANT_PICKER_PATH, context.origin)
    const next = sanitizeRedirectPath(`${pathname}${search}`, HOME_PATH)

    if (next !== HOME_PATH) {
      pickerUrl.searchParams.set("next", next)
    }

    return redirectWithSession(pickerUrl, response, sessionHeaders)
  }

  return response
}

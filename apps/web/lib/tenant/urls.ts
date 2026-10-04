// Endereços do app nos dois modos de multi-tenancy (NEXT_PUBLIC_TENANCY_MODE):
//
// - "subdomain" (padrão quando NEXT_PUBLIC_ROOT_DOMAIN está definida):
//   {slug}.{raiz} identifica a imobiliária. A raiz atende login, cadastro,
//   onboarding e a escolha de imobiliária; cada subdomínio atende o CRM e as
//   páginas públicas (URLs curtas).
// - "single-host" (padrão sem NEXT_PUBLIC_ROOT_DOMAIN, ex.: deploy *.vercel.app):
//   tudo num único host (NEXT_PUBLIC_SITE_URL), imobiliária escolhida pelo
//   usuário (cookie validado) e páginas públicas nas rotas longas.
//
// Toda URL absoluta do app (e-mails, links públicos, redirecionamentos entre
// hosts) nasce daqui: env + slug validado, nunca Host/X-Forwarded-Host.
// Sem `server-only`: o navegador também usa (as envs NEXT_PUBLIC_* são inlinadas).
// A lógica pura (modo, slug, host, montagem das URLs) fica em @workspace/core/tenant.

import { classifyHost, getSharedCookieDomain, type TenantHost } from "@workspace/core/tenant/host"
import {
  buildAppOriginFor,
  buildAppUrlFor,
  buildCapturePathFor,
  buildCaptureUrlFor,
  buildInvitationUrlFor,
  buildLandingPagePathFor,
  buildLandingPageUrlFor,
  buildPortalFeedUrlFor,
  buildProposalShareUrlFor,
  buildTenantLinkPreviewFor,
  buildTenantOriginFor,
  buildTenantUrlFor,
  type TenantLinkPreview,
} from "@workspace/core/tenant/links"
import {
  resolveTenancyConfig,
  type TenancyConfig,
  type TenancyMode,
} from "@workspace/core/tenant/mode"
import { resolveRequestTenancy, type RequestTenancy } from "@workspace/core/tenant/paths"
import {
  RESERVED_SUBDOMAINS,
  isValidTenantSlug as isValidTenantSlugRule,
} from "@workspace/core/tenant/slug"

export { RESERVED_SUBDOMAINS }
export type { RequestTenancy, TenancyConfig, TenancyMode, TenantHost, TenantLinkPreview }

const DEVELOPMENT_SITE_ORIGIN = "http://localhost:3000"

/**
 * Origem do host único: NEXT_PUBLIC_SITE_URL; na Vercel, a URL de produção do
 * projeto (variável de sistema); em desenvolvimento, http://localhost:3000.
 * As referências são literais para o Next.js inlinar as NEXT_PUBLIC_*.
 */
function readSiteUrl(): string | null {
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.trim()

  if (configured) {
    return configured
  }

  const vercel =
    process.env.NEXT_PUBLIC_VERCEL_PROJECT_PRODUCTION_URL?.trim() ||
    process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim()

  if (vercel) {
    return vercel
  }

  return process.env.NODE_ENV === "production" ? null : DEVELOPMENT_SITE_ORIGIN
}

/** Configuração efetiva do multi-tenancy (nunca lança). */
export function getTenancyConfig(): TenancyConfig {
  return resolveTenancyConfig({
    configuredMode: process.env.NEXT_PUBLIC_TENANCY_MODE,
    rootDomain: process.env.NEXT_PUBLIC_ROOT_DOMAIN,
    siteUrl: readSiteUrl(),
  })
}

export function getTenancyMode(): TenancyMode {
  return getTenancyConfig().mode
}

export function isSubdomainTenancy(): boolean {
  return getTenancyMode() === "subdomain"
}

export function isValidTenantSlug(slug: string): boolean {
  return isValidTenantSlugRule(slug)
}

/** Domínio raiz no modo subdomain; `null` no modo single-host (não lança). */
export function tryGetRootDomain(): string | null {
  const config = getTenancyConfig()
  return config.mode === "subdomain" ? config.rootDomain : null
}

/** Domínio raiz do modo subdomain. Lança no modo single-host: confira o modo antes. */
export function getRootDomain(): string {
  const root = tryGetRootDomain()

  if (!root) {
    throw new Error(
      "NEXT_PUBLIC_ROOT_DOMAIN não está configurada: o app está no modo de host único."
    )
  }

  return root
}

/** Origem do domínio raiz (subdomain) ou do host único (single-host). */
export function getAppOrigin(): string {
  return buildAppOriginFor(getTenancyConfig())
}

/** URL absoluta no domínio raiz (ou no host único). */
export function buildAppUrl(path = "/"): string {
  return buildAppUrlFor(getTenancyConfig(), path)
}

/** Origem da imobiliária: o subdomínio dela ou o host único. */
export function buildTenantOrigin(slug: string): string {
  return buildTenantOriginFor(getTenancyConfig(), slug)
}

export function buildTenantUrl(slug: string, path = "/"): string {
  return buildTenantUrlFor(getTenancyConfig(), slug, path)
}

/** Como tratar o Host da requisição (no single-host o host é ignorado). */
export function classifyRequestHost(host: string | null | undefined): RequestTenancy {
  return resolveRequestTenancy(getTenancyConfig(), host)
}

/**
 * Extrai o slug do tenant do Host. Só aceita subdomínio direto da raiz
 * configurada; qualquer outro host (raiz, www, domínio estranho) e o modo
 * single-host devolvem null.
 */
export function parseTenantSlugFromHost(host: string | null | undefined): string | null {
  const root = tryGetRootDomain()

  if (!root) {
    return null
  }

  const result = classifyHost(host, root)
  return result.kind === "tenant" ? result.slug : null
}

/**
 * Se a sessão vale em todos os subdomínios (cookie com Domain=.raiz). Falso em
 * localhost/IP e no modo single-host.
 */
export function supportsSharedSessionCookies(): boolean {
  const root = tryGetRootDomain()
  return root ? getSharedCookieDomain(root) !== null : false
}

// Links públicos de cada imobiliária -------------------------------------------

/** Prévia do link que o slug compõe (cadastro): subdomínio do CRM ou link da captação. */
export function buildTenantLinkPreview(): TenantLinkPreview | null {
  return buildTenantLinkPreviewFor(getTenancyConfig())
}

/** Caminho relativo da landing page no host em que ela é servida. */
export function buildLandingPagePath(orgSlug: string, pageSlug: string): string {
  return buildLandingPagePathFor(getTenancyConfig(), orgSlug, pageSlug)
}

export function buildLandingPageUrl(orgSlug: string, pageSlug: string): string {
  return buildLandingPageUrlFor(getTenancyConfig(), orgSlug, pageSlug)
}

/** Caminho relativo do formulário de captação no host em que ele é servido. */
export function buildCapturePath(orgSlug: string): string {
  return buildCapturePathFor(getTenancyConfig(), orgSlug)
}

export function buildCaptureUrl(orgSlug: string): string {
  return buildCaptureUrlFor(getTenancyConfig(), orgSlug)
}

export function buildPortalFeedUrl(orgSlug: string, feedToken: string): string {
  return buildPortalFeedUrlFor(getTenancyConfig(), orgSlug, feedToken)
}

export function buildInvitationUrl(orgSlug: string, token: string): string {
  return buildInvitationUrlFor(getTenancyConfig(), orgSlug, token)
}

/** Link público da proposta (/proposta/{token}) no endereço da imobiliária. */
export function buildProposalShareUrl(orgSlug: string, token: string): string {
  return buildProposalShareUrlFor(getTenancyConfig(), orgSlug, token)
}

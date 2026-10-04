// Decisões de roteamento do multi-tenant usadas pelo proxy. Módulo puro.
//
// Modo subdomain:
//   {slug}.raiz/lp/{pagina}              → /lp/{slug}/{pagina}
//   {slug}.raiz/captar                   → /captar/{slug}
//   {slug}.raiz/imovel/{codigo}          → /imovel/{slug}/{codigo}
//   {slug}.raiz/api/feeds/vrsync.xml     → /api/feeds/{slug}/vrsync.xml
//   raiz/lp/{org}/{pagina}, raiz/captar/{slug},
//   raiz/imovel/{org}/{codigo}           → 308 para o subdomínio
//   raiz/api/feeds/{slug}/vrsync.xml     → continua respondendo (robôs dos portais)
// Modo single-host: nenhuma reescrita; as rotas longas atendem direto.

import { classifyHost, type TenantHost } from "./host"
import type { TenancyConfig } from "./mode"
import { PUBLIC_PROPERTY_PATH_PREFIX } from "./public-property"

/** Como o proxy trata o host da requisição. */
export type RequestTenancy = TenantHost | { kind: "single-host" }

export function resolveRequestTenancy(
  config: TenancyConfig,
  host: string | null | undefined
): RequestTenancy {
  return config.mode === "subdomain"
    ? classifyHost(host, config.rootDomain)
    : { kind: "single-host" }
}

/** Prefixos públicos que carregam o slug no caminho interno. */
const TENANT_PUBLIC_PREFIXES = [
  "/lp",
  "/captar",
  PUBLIC_PROPERTY_PATH_PREFIX,
  "/api/feeds",
] as const

function matchesPrefix(pathname: string, prefix: string) {
  return pathname === prefix || pathname.startsWith(`${prefix}/`)
}

/**
 * Caminho interno de uma página pública do subdomínio (o slug entra logo
 * depois do prefixo), ou `null` quando o caminho não é público. Essas páginas
 * resolvem a imobiliária sozinhas e respondem 404 quando ela não existe.
 */
export function getTenantPublicRewrite(pathname: string, slug: string): string | null {
  const prefix = TENANT_PUBLIC_PREFIXES.find((item) => matchesPrefix(pathname, item))

  if (!prefix) {
    return null
  }

  return `${prefix}/${slug}${pathname.slice(prefix.length)}`
}

export type LegacyPublicRedirect = {
  /** Slug lido do caminho (minúsculo, ainda não validado). */
  slug: string
  /** Caminho curto no subdomínio. */
  path: string
}

function decodeSegment(segment: string) {
  try {
    return decodeURIComponent(segment).trim().toLowerCase()
  } catch {
    return null
  }
}

/**
 * URL longa de página pública no domínio raiz que, no modo subdomain, vai para
 * o subdomínio: /lp/{org}/{pagina}[/...], /imovel/{org}/{codigo}[/...] e
 * /captar/{slug}[/...]. O feed fica de fora de propósito (compatibilidade com
 * os portais).
 */
export function getLegacyPublicRedirect(pathname: string): LegacyPublicRedirect | null {
  const segments = pathname.split("/")

  // ["", "lp", org, pagina, ...]
  if (segments[1] === "lp" && segments.length >= 4 && segments[2] && segments[3]) {
    const slug = decodeSegment(segments[2])
    return slug ? { slug, path: `/lp/${segments.slice(3).join("/")}` } : null
  }

  // ["", "imovel", org, codigo, ...]
  if (segments[1] === "imovel" && segments.length >= 4 && segments[2] && segments[3]) {
    const slug = decodeSegment(segments[2])
    return slug ? { slug, path: `/imovel/${segments.slice(3).join("/")}` } : null
  }

  // ["", "captar", slug, ...]
  if (segments[1] === "captar" && segments.length >= 3 && segments[2]) {
    const slug = decodeSegment(segments[2])
    const rest = segments.slice(3).join("/")
    return slug ? { slug, path: rest ? `/captar/${rest}` : "/captar" } : null
  }

  return null
}

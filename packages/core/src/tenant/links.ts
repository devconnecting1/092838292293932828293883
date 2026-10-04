// URLs do app nos dois modos de multi-tenancy. Módulo puro: a configuração
// (modo, domínio raiz, origem do site) vem de quem chama.
//
//                      subdomain                              single-host
// app (raiz)           https://raiz/...                       https://site/...
// CRM da imobiliária   https://{slug}.raiz/painel             https://site/painel
// landing page         https://{slug}.raiz/lp/{pagina}        https://site/lp/{slug}/{pagina}
// página do imóvel     https://{slug}.raiz/imovel/{codigo}    https://site/imovel/{slug}/{codigo}
//                      (ver ./public-property.ts)
// captação             https://{slug}.raiz/captar             https://site/captar/{slug}
// feed dos portais     https://{slug}.raiz/api/feeds/vrsync.xml?token=...
//                                                             https://site/api/feeds/{slug}/vrsync.xml?token=...
// convite              https://{slug}.raiz/convite/{token}    https://site/convite/{token}
// proposta (link)      https://{slug}.raiz/proposta/{token}   https://site/proposta/{token}

import { buildProposalSharePath } from "../proposals/share"
import { getProtocolForRootDomain } from "./host"
import type { TenancyConfig } from "./mode"
import { isValidTenantSlug } from "./slug"

function normalizePath(path: string) {
  return path.startsWith("/") ? path : `/${path}`
}

function assertTenantSlug(slug: string) {
  if (!isValidTenantSlug(slug)) {
    throw new Error("Slug de imobiliária inválido para os endereços do app.")
  }
}

/** Origem do domínio raiz (subdomain) ou do host único (single-host). */
export function buildAppOriginFor(config: TenancyConfig): string {
  if (config.mode === "subdomain") {
    return `${getProtocolForRootDomain(config.rootDomain)}://${config.rootDomain}`
  }

  if (!config.siteOrigin) {
    throw new Error(
      "Defina NEXT_PUBLIC_SITE_URL: no modo de host único ela é a origem dos links absolutos do app."
    )
  }

  return config.siteOrigin
}

export function buildAppUrlFor(config: TenancyConfig, path = "/"): string {
  return `${buildAppOriginFor(config)}${normalizePath(path)}`
}

/** Origem onde a imobiliária é atendida: o subdomínio dela ou o host único. */
export function buildTenantOriginFor(config: TenancyConfig, slug: string): string {
  assertTenantSlug(slug)

  if (config.mode === "subdomain") {
    return `${getProtocolForRootDomain(config.rootDomain)}://${slug}.${config.rootDomain}`
  }

  return buildAppOriginFor(config)
}

export function buildTenantUrlFor(config: TenancyConfig, slug: string, path = "/"): string {
  return `${buildTenantOriginFor(config, slug)}${normalizePath(path)}`
}

/**
 * Prévia do link que o slug compõe, para o cadastro mostrar enquanto a pessoa
 * digita: `prefix + slug + suffix`.
 * - subdomain: o slug é o endereço do CRM e dos links públicos
 *   (https://{slug}.raiz).
 * - single-host: o CRM não usa o slug; ele só entra nos links públicos, como o
 *   da captação (https://site/captar/{slug}).
 * `null` no host único sem origem configurada (não há link absoluto para mostrar).
 */
export type TenantLinkPreview = {
  kind: "crm" | "public-pages"
  prefix: string
  suffix: string
}

export function buildTenantLinkPreviewFor(config: TenancyConfig): TenantLinkPreview | null {
  if (config.mode === "subdomain") {
    return {
      kind: "crm",
      prefix: `${getProtocolForRootDomain(config.rootDomain)}://`,
      suffix: `.${config.rootDomain}`,
    }
  }

  if (!config.siteOrigin) {
    return null
  }

  return { kind: "public-pages", prefix: `${config.siteOrigin}/captar/`, suffix: "" }
}

/** Caminho relativo da landing page no host em que ela é servida. */
export function buildLandingPagePathFor(
  config: TenancyConfig,
  orgSlug: string,
  pageSlug: string
): string {
  const page = encodeURIComponent(pageSlug)

  return config.mode === "subdomain" ? `/lp/${page}` : `/lp/${encodeURIComponent(orgSlug)}/${page}`
}

export function buildLandingPageUrlFor(
  config: TenancyConfig,
  orgSlug: string,
  pageSlug: string
): string {
  return `${buildTenantOriginFor(config, orgSlug)}${buildLandingPagePathFor(config, orgSlug, pageSlug)}`
}

/** Caminho relativo do formulário público de captação. */
export function buildCapturePathFor(config: TenancyConfig, orgSlug: string): string {
  return config.mode === "subdomain" ? "/captar" : `/captar/${encodeURIComponent(orgSlug)}`
}

export function buildCaptureUrlFor(config: TenancyConfig, orgSlug: string): string {
  return `${buildTenantOriginFor(config, orgSlug)}${buildCapturePathFor(config, orgSlug)}`
}

export function buildPortalFeedUrlFor(
  config: TenancyConfig,
  orgSlug: string,
  feedToken: string
): string {
  const path =
    config.mode === "subdomain"
      ? "/api/feeds/vrsync.xml"
      : `/api/feeds/${encodeURIComponent(orgSlug)}/vrsync.xml`

  return `${buildTenantOriginFor(config, orgSlug)}${path}?token=${encodeURIComponent(feedToken)}`
}

/**
 * Link público da proposta, no endereço da imobiliária. O token já identifica
 * a proposta: o caminho é o mesmo nos dois modos, sem slug.
 */
export function buildProposalShareUrlFor(
  config: TenancyConfig,
  orgSlug: string,
  token: string
): string {
  return `${buildTenantOriginFor(config, orgSlug)}${buildProposalSharePath(token)}`
}

export function buildInvitationUrlFor(
  config: TenancyConfig,
  orgSlug: string,
  token: string
): string {
  return `${buildTenantOriginFor(config, orgSlug)}/convite/${encodeURIComponent(token)}`
}

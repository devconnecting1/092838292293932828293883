// Modo de multi-tenancy do app. Módulo puro: quem chama lê as variáveis de
// ambiente e passa os valores.
//
// - "subdomain": cada imobiliária em {slug}.{raiz}; exige NEXT_PUBLIC_ROOT_DOMAIN.
// - "single-host": tudo num único host (ex.: URL *.vercel.app, que não aceita
//   subdomínio curinga). A imobiliária atual vem da escolha do usuário (cookie
//   validado no servidor) e as páginas públicas usam as rotas longas.

import { isLocalHostname, normalizeRootDomain } from "./host"

export type TenancyMode = "subdomain" | "single-host"

export type TenancyConfig =
  | { mode: "subdomain"; rootDomain: string }
  /** `siteOrigin` null: sem NEXT_PUBLIC_SITE_URL, só URLs relativas funcionam. */
  | { mode: "single-host"; siteOrigin: string | null }

export type TenancyInput = {
  /** NEXT_PUBLIC_TENANCY_MODE */
  configuredMode?: string | null
  /** NEXT_PUBLIC_ROOT_DOMAIN */
  rootDomain?: string | null
  /** NEXT_PUBLIC_SITE_URL (ou a URL de produção informada pelo provedor) */
  siteUrl?: string | null
}

/**
 * Modo efetivo:
 * - "single-host" explícito sempre vence;
 * - caso contrário, "subdomain" quando há domínio raiz válido;
 * - sem domínio raiz (inclusive com "subdomain" explícito), "single-host".
 *   Nunca lança: um deploy sem domínio próprio continua funcionando.
 */
export function resolveTenancyMode(
  configuredMode: string | null | undefined,
  rootDomain: string | null | undefined
): TenancyMode {
  const mode = typeof configuredMode === "string" ? configuredMode.trim().toLowerCase() : ""

  if (mode === "single-host") {
    return "single-host"
  }

  return normalizeRootDomain(rootDomain) ? "subdomain" : "single-host"
}

/**
 * Origem (protocolo + host) de uma URL do site. Aceita host sem protocolo,
 * como as variáveis de sistema da Vercel ("projeto.vercel.app"): https, ou
 * http em localhost/IP. `null` quando o valor não é uma URL http(s).
 */
export function normalizeSiteOrigin(value: string | null | undefined): string | null {
  if (typeof value !== "string" || !value.trim()) {
    return null
  }

  const trimmed = value.trim()
  let candidate = trimmed

  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) {
    const hostname = trimmed.split(/[/:]/)[0]?.toLowerCase() ?? ""
    candidate = `${isLocalHostname(hostname) ? "http" : "https"}://${trimmed}`
  }

  try {
    const url = new URL(candidate)
    return url.protocol === "https:" || url.protocol === "http:" ? url.origin : null
  } catch {
    return null
  }
}

export function resolveTenancyConfig(input: TenancyInput): TenancyConfig {
  const rootDomain = normalizeRootDomain(input.rootDomain)

  if (resolveTenancyMode(input.configuredMode, rootDomain) === "subdomain" && rootDomain) {
    return { mode: "subdomain", rootDomain }
  }

  return { mode: "single-host", siteOrigin: normalizeSiteOrigin(input.siteUrl) }
}

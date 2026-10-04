// Endereços da página pública do imóvel com a configuração do app (env). A
// regra pura fica em @workspace/core/tenant/public-property, com testes.
// Sem `server-only`: telas do CRM (cliente) também montam o link para copiar.
//
//   subdomain:    https://{slug}.raiz/imovel/{codigo}
//   single-host:  https://site/imovel/{slug}/{codigo}

import {
  normalizePublicPropertyCode,
  publicPropertyPath,
  publicPropertyUrl,
} from "@workspace/core/tenant/public-property"

import { getTenancyConfig } from "@/lib/tenant/urls"

export { normalizePublicPropertyCode }

/** Caminho relativo da página do imóvel no host em que ela é servida. Lança com código inválido. */
export function buildPublicPropertyPath(orgSlug: string, code: string): string {
  return publicPropertyPath(getTenancyConfig(), orgSlug, code)
}

/**
 * Link absoluto para copiar e compartilhar (WhatsApp, Instagram). Lança com
 * slug/código inválido ou, no host único, sem NEXT_PUBLIC_SITE_URL.
 */
export function buildPublicPropertyUrl(orgSlug: string, code: string): string {
  return publicPropertyUrl(getTenancyConfig(), orgSlug, code)
}

/** Como `buildPublicPropertyUrl`, mas devolve `null` em vez de lançar. */
export function tryBuildPublicPropertyUrl(orgSlug: string, code: string): string | null {
  try {
    return buildPublicPropertyUrl(orgSlug, code)
  } catch {
    return null
  }
}

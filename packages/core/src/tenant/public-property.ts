// Página pública de cada imóvel ativo (grátis, fora do limite de landing
// pages). Módulo puro: a configuração do multi-tenancy vem de quem chama.
//
//                      subdomain                                single-host
// página do imóvel     https://{slug}.raiz/imovel/{codigo}      https://site/imovel/{slug}/{codigo}
//
// O código é o de referência do imóvel (ex.: IMV-000123), sempre em maiúsculas
// no endereço canônico.

import { buildTenantOriginFor } from "./links"
import type { TenancyConfig } from "./mode"
import { isValidTenantSlug } from "./slug"

/** Prefixo das páginas públicas de imóvel (singular: não colide com /imoveis do CRM). */
export const PUBLIC_PROPERTY_PATH_PREFIX = "/imovel"

/** Teto do código no endereço (o banco usa IMV- + dígitos). */
export const PUBLIC_PROPERTY_CODE_MAX_LENGTH = 40

/** Letras/dígitos em grupos separados por um hífen, sem hífen nas pontas. */
const PUBLIC_PROPERTY_CODE_PATTERN = /^[A-Z0-9]+(?:-[A-Z0-9]+)*$/

/**
 * Código de referência vindo da URL (ou do cadastro) → forma canônica em
 * maiúsculas. `null` quando não é um código válido para endereço público
 * (quem chama responde 404 sem consultar o banco).
 */
export function normalizePublicPropertyCode(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null

  let decoded: string

  try {
    decoded = decodeURIComponent(value)
  } catch {
    return null
  }

  const code = decoded.trim().toUpperCase()

  if (code.length === 0 || code.length > PUBLIC_PROPERTY_CODE_MAX_LENGTH) return null

  return PUBLIC_PROPERTY_CODE_PATTERN.test(code) ? code : null
}

function requireCode(code: string) {
  const normalized = normalizePublicPropertyCode(code)

  if (!normalized) {
    throw new Error("Código de imóvel inválido para o endereço público.")
  }

  return normalized
}

/** Caminho relativo da página pública do imóvel no host em que ela é servida. */
export function publicPropertyPath(config: TenancyConfig, orgSlug: string, code: string): string {
  const normalized = encodeURIComponent(requireCode(code))

  if (config.mode === "subdomain") {
    return `${PUBLIC_PROPERTY_PATH_PREFIX}/${normalized}`
  }

  if (!isValidTenantSlug(orgSlug)) {
    throw new Error("Slug de imobiliária inválido para os endereços do app.")
  }

  return `${PUBLIC_PROPERTY_PATH_PREFIX}/${encodeURIComponent(orgSlug)}/${normalized}`
}

/**
 * Link absoluto da página pública do imóvel (para copiar, mandar no WhatsApp e
 * usar no canonical/sitemap). No host único exige NEXT_PUBLIC_SITE_URL.
 */
export function publicPropertyUrl(config: TenancyConfig, orgSlug: string, code: string): string {
  return `${buildTenantOriginFor(config, orgSlug)}${publicPropertyPath(config, orgSlug, code)}`
}

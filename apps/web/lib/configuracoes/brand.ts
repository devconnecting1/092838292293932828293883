/**
 * Chaves de organizations.brand (jsonb). O formulário público de captação lê
 * o mesmo objeto via RPC get_public_organization:
 *   { "primary_color": "#0C6B63", "logo_url": "https://..." }
 * Outras chaves existentes são preservadas ao salvar.
 */
export const BRAND_PRIMARY_COLOR_KEY = "primary_color"
export const BRAND_LOGO_URL_KEY = "logo_url"

export const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/

export type OrganizationBrand = {
  primaryColor: string | null
  logoUrl: string | null
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

export function isHttpsUrl(value: string) {
  try {
    return new URL(value).protocol === "https:"
  } catch {
    return false
  }
}

export function readOrganizationBrand(value: unknown): OrganizationBrand {
  if (!isPlainObject(value)) {
    return { primaryColor: null, logoUrl: null }
  }

  const color = value[BRAND_PRIMARY_COLOR_KEY]
  const logo = value[BRAND_LOGO_URL_KEY]

  return {
    primaryColor:
      typeof color === "string" && HEX_COLOR_PATTERN.test(color) ? color.toUpperCase() : null,
    logoUrl: typeof logo === "string" && isHttpsUrl(logo) ? logo : null,
  }
}

/** Novo valor de `brand`: aplica cor e logo mantendo as demais chaves. */
export function mergeOrganizationBrand(current: unknown, next: OrganizationBrand) {
  const merged: Record<string, unknown> = isPlainObject(current) ? { ...current } : {}

  if (next.primaryColor) {
    merged[BRAND_PRIMARY_COLOR_KEY] = next.primaryColor.toUpperCase()
  } else {
    delete merged[BRAND_PRIMARY_COLOR_KEY]
  }

  if (next.logoUrl) {
    merged[BRAND_LOGO_URL_KEY] = next.logoUrl
  } else {
    delete merged[BRAND_LOGO_URL_KEY]
  }

  return merged
}

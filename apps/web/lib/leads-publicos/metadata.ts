import type { Metadata } from "next"

import { buildPublicStorageUrl, getStorageBaseUrl } from "@/lib/landing/theme"
import { LANDING_ASSETS_BUCKET, LANDING_PROPERTY_MEDIA_BUCKET } from "@/lib/landing/types"
import type { PublicLandingPage } from "@/lib/leads-publicos/queries"
import { buildLandingPageUrl, isValidTenantSlug } from "@/lib/tenant/urls"

const DESCRIPTION_MAX_LENGTH = 200

export const LANDING_NOT_FOUND_METADATA: Metadata = {
  title: { absolute: "Página não encontrada" },
  robots: { index: false, follow: false },
}

function clip(value: string, max: number) {
  const chars = Array.from(value.replace(/\s+/g, " ").trim())
  return chars.length > max
    ? `${chars
        .slice(0, max - 1)
        .join("")
        .trimEnd()}…`
    : chars.join("")
}

/**
 * URL canônica da landing, usada no canonical, no og:url e no JSON-LD:
 * {slug}.raiz/lp/{pagina} (modo subdomain) ou site/lp/{slug}/{pagina} (host
 * único). null quando o slug não é válido ou falta a origem do host único.
 */
export function buildLandingCanonicalUrl(orgSlug: string, pageSlug: string) {
  if (!isValidTenantSlug(orgSlug)) {
    return null
  }

  try {
    return buildLandingPageUrl(orgSlug, pageSlug)
  } catch {
    // Host único sem NEXT_PUBLIC_SITE_URL: a página sai sem canonical.
    return null
  }
}

/** og_image_path → primeiro banner → fundo (landing-assets) → capa do primeiro imóvel. */
function resolveShareImage({ payload }: PublicLandingPage) {
  const base = getStorageBaseUrl()
  const { seo, theme } = payload.page

  const candidates = [
    buildPublicStorageUrl(base, LANDING_ASSETS_BUCKET, seo.og_image_path),
    buildPublicStorageUrl(base, LANDING_ASSETS_BUCKET, theme.banner_image_paths?.[0]),
    buildPublicStorageUrl(base, LANDING_ASSETS_BUCKET, theme.background_image_path),
    buildPublicStorageUrl(base, LANDING_PROPERTY_MEDIA_BUCKET, payload.properties[0]?.cover_path),
  ]

  return candidates.find((url): url is string => Boolean(url)) ?? null
}

export function buildLandingMetadata(landing: PublicLandingPage): Metadata {
  const { payload, orgSlug, pageSlug } = landing
  const { page, organization } = payload
  const headline = page.content.headline ?? page.name

  const title = page.seo.title ?? clip(`${headline} | ${organization.name}`, 90)

  const place = [organization.city, organization.state].filter(Boolean).join("/")
  const description = clip(
    page.seo.description ??
      page.content.subheadline ??
      page.content.description ??
      `${headline} — atendimento com ${organization.name}${place ? ` em ${place}` : ""}.`,
    DESCRIPTION_MAX_LENGTH
  )

  const canonical = buildLandingCanonicalUrl(orgSlug, pageSlug) ?? undefined
  const image = resolveShareImage(landing)
  const images = image ? [{ url: image, alt: headline }] : undefined

  return {
    title: { absolute: title },
    description,
    alternates: canonical ? { canonical } : undefined,
    robots: { index: true, follow: true },
    openGraph: {
      type: "website",
      locale: "pt_BR",
      siteName: organization.name,
      title,
      description,
      url: canonical,
      images,
    },
    twitter: {
      card: image ? "summary_large_image" : "summary",
      title,
      description,
      images: image ? [image] : undefined,
    },
  }
}

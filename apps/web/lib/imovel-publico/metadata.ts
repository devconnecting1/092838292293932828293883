import type { Metadata } from "next"

import type { PublicPropertyPayload } from "@/lib/imovel-publico/types"
import { tryBuildPublicPropertyUrl } from "@/lib/imovel-publico/urls"
import type { PublicPropertyView } from "@/lib/imovel-publico/view-model"

const TITLE_MAX_LENGTH = 90
const DESCRIPTION_MAX_LENGTH = 200

export const PUBLIC_PROPERTY_NOT_FOUND_METADATA: Metadata = {
  title: { absolute: "Imóvel indisponível" },
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
 * URL canônica (canonical, og:url, JSON-LD e mensagem do WhatsApp):
 * {slug}.raiz/imovel/{codigo} ou site/imovel/{slug}/{codigo}. null quando falta
 * a origem do host único.
 */
export function buildPublicPropertyCanonicalUrl(payload: PublicPropertyPayload) {
  return tryBuildPublicPropertyUrl(payload.orgSlug, payload.property.code)
}

/** "Apartamento à venda em Bela Vista, São Paulo/SP · 80 m² · 2 quartos · Venda R$ 500.000". */
export function buildPublicPropertySummary(view: PublicPropertyView) {
  const heading = [view.typeLabel, view.purposePhrase].filter(Boolean).join(" ")
  const place = view.place ? `${heading} em ${view.place}` : heading
  const specs = view.specs.slice(0, 3).map((spec) => spec.value)
  const prices = view.prices.map(
    (price) => `${price.label} ${price.amount}${price.suffix ? price.suffix : ""}`
  )

  return [place, ...specs, ...prices].join(" · ")
}

/** Imagem de compartilhamento: a capa (primeira foto). */
function shareImage(view: PublicPropertyView) {
  return view.photos[0]?.src ?? null
}

export function buildPublicPropertyMetadata(
  payload: PublicPropertyPayload,
  view: PublicPropertyView
): Metadata {
  const title = clip(`${view.title} | ${view.organization.name}`, TITLE_MAX_LENGTH)
  const description = clip(
    `${buildPublicPropertySummary(view)}. Fale com ${view.organization.name}.`,
    DESCRIPTION_MAX_LENGTH
  )
  const canonical = buildPublicPropertyCanonicalUrl(payload) ?? undefined
  const image = shareImage(view)

  return {
    title: { absolute: title },
    description,
    alternates: canonical ? { canonical } : undefined,
    robots: { index: true, follow: true },
    openGraph: {
      type: "website",
      locale: "pt_BR",
      siteName: view.organization.name,
      title,
      description,
      url: canonical,
      images: image ? [{ url: image, alt: view.title }] : undefined,
    },
    twitter: {
      card: image ? "summary_large_image" : "summary",
      title,
      description,
      images: image ? [image] : undefined,
    },
  }
}

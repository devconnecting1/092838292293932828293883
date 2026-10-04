import type { Metadata } from "next"
import { notFound } from "next/navigation"

import { PublicPropertyPage } from "@/components/imovel-publico/property-page"
import { LandingTracking } from "@/components/leads-publicos/tracking"
import { buildPublicPropertyJsonLd } from "@/lib/imovel-publico/json-ld"
import {
  buildPublicPropertyCanonicalUrl,
  buildPublicPropertyMetadata,
  PUBLIC_PROPERTY_NOT_FOUND_METADATA,
} from "@/lib/imovel-publico/metadata"
import { getPublicProperty } from "@/lib/imovel-publico/queries"
import { buildPublicPropertyView } from "@/lib/imovel-publico/view-model"
import { serializeJsonLd } from "@/lib/leads-publicos/json-ld"

/**
 * Página pública e grátis de cada imóvel ATIVO ({slug}.raiz/imovel/{codigo},
 * reescrita pelo proxy para cá; no host único, /imovel/{slug}/{codigo}). Não
 * conta no limite de landing pages.
 *
 * ISR como as landing pages: HTML em cache, regerado a cada 60 s (o imóvel que
 * sai de ativo some em até 1 minuto). `generateStaticParams` vazio gera cada
 * endereço no primeiro acesso e o mantém em cache. Nada aqui lê cookies,
 * headers ou searchParams: o token antirrobô é pedido pelo formulário ao montar
 * e as UTMs são lidas no navegador.
 *
 * Medição: Meta Pixel e gtag.js pelos IDs da imobiliária, com os scripts
 * oficiais e só depois do aceite de cookies (LandingTracking, o mesmo das
 * landing pages). Sem Google Tag Manager.
 */
export const revalidate = 60

export async function generateStaticParams(): Promise<{ org: string; codigo: string }[]> {
  return []
}

type PublicPropertyRouteProps = {
  params: Promise<{ org: string; codigo: string }>
}

export async function generateMetadata({ params }: PublicPropertyRouteProps): Promise<Metadata> {
  const { org, codigo } = await params
  const payload = await getPublicProperty(org, codigo)

  if (!payload) {
    return PUBLIC_PROPERTY_NOT_FOUND_METADATA
  }

  const pageUrl = buildPublicPropertyCanonicalUrl(payload)
  return buildPublicPropertyMetadata(payload, buildPublicPropertyView(payload, { pageUrl }))
}

export default async function PublicPropertyRoute({ params }: PublicPropertyRouteProps) {
  const { org, codigo } = await params
  const payload = await getPublicProperty(org, codigo)

  if (!payload) {
    notFound()
  }

  const pageUrl = buildPublicPropertyCanonicalUrl(payload)
  const view = buildPublicPropertyView(payload, { pageUrl })
  const jsonLd = serializeJsonLd(buildPublicPropertyJsonLd(payload, view, pageUrl))

  return (
    <>
      {jsonLd ? (
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd }} />
      ) : null}
      <PublicPropertyPage
        view={view}
        orgSlug={payload.orgSlug}
        hasTracking={Boolean(payload.tracking.metaPixelId || payload.tracking.googleTagId)}
      />
      <LandingTracking
        metaPixelId={payload.tracking.metaPixelId}
        googleTagId={payload.tracking.googleTagId}
        privacyHref="#privacidade"
        captureFirstPartyAttribution={false}
      />
    </>
  )
}

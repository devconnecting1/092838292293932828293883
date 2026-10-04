"use client"

import * as React from "react"
import Script from "next/script"

import { CookieConsentBanner } from "@/components/leads-publicos/cookie-consent-banner"
import { captureAttribution } from "@/lib/leads-publicos/attribution"
import { saveLandingConsent, useLandingConsent } from "@/lib/leads-publicos/consent"
import {
  GOOGLE_TAG_ID_PATTERN,
  META_PIXEL_ID_PATTERN,
  safeGoogleTagId,
  safeMetaPixelId,
  toInlineScriptString,
} from "@/lib/leads-publicos/tracking-ids"

type TrackingWindow = Window & {
  fbq?: (...args: unknown[]) => void
  gtag?: (...args: unknown[]) => void
}

type LandingTrackingProps = {
  /** tracking.meta_pixel_id da página (só dígitos). */
  metaPixelId?: string | null
  /** tracking.google_tag_id da página (G-, GT- ou AW-). */
  googleTagId?: string | null
  privacyHref: string
  /**
   * Guarda UTMs e click ids em cookies próprios ao chegar (padrão: sim). A
   * página pública do imóvel passa `false`: ela lê a atribuição só do link.
   */
  captureFirstPartyAttribution?: boolean
}

/**
 * Rastreamento da landing page:
 * - guarda UTMs e click ids first-party ao chegar (sempre);
 * - com algum rastreador configurado, mostra o aviso de cookies e só carrega
 *   Meta Pixel e gtag.js depois de "Aceitar" (cookie `lp_consent`).
 * Os IDs são revalidados por regex e interpolados com JSON.stringify.
 *
 * O contêiner do Google Tag Manager (tracking.gtm_container_id) NÃO é carregado:
 * ele executa qualquer JavaScript definido por quem controla o contêiner, e a
 * landing é servida na mesma origem (host único) ou no mesmo domínio de cookie
 * (subdomínios) do CRM, cujos cookies de sessão do Supabase são legíveis por
 * JavaScript. Só voltará quando as páginas públicas tiverem origem própria, sem
 * cookies de sessão. Meta Pixel e gtag.js são scripts oficiais carregados só
 * pelo ID (sem código definido pela imobiliária).
 */
export function LandingTracking({
  metaPixelId,
  googleTagId,
  privacyHref,
  captureFirstPartyAttribution = true,
}: LandingTrackingProps) {
  const pixelId = safeMetaPixelId(metaPixelId)
  const tagId = safeGoogleTagId(googleTagId)
  const hasTrackers = Boolean(pixelId || tagId)
  const consent = useLandingConsent()
  const canTrack = hasTrackers && consent === "granted"

  React.useEffect(() => {
    if (captureFirstPartyAttribution) {
      captureAttribution()
    }
  }, [captureFirstPartyAttribution])

  // Revalida cada ID com a regex logo antes de montar o script e interpola só
  // o literal escapado (toInlineScriptString), nunca o texto cru.
  const pixelLiteral =
    canTrack && pixelId && META_PIXEL_ID_PATTERN.test(pixelId)
      ? toInlineScriptString(pixelId)
      : null
  const tagLiteral =
    canTrack && tagId && GOOGLE_TAG_ID_PATTERN.test(tagId) ? toInlineScriptString(tagId) : null

  return (
    <>
      {pixelLiteral ? (
        <Script id="lp-meta-pixel" strategy="afterInteractive">
          {`!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');fbq('init',${pixelLiteral});fbq('track','PageView');`}
        </Script>
      ) : null}
      {tagLiteral && tagId ? (
        <>
          <Script
            id="lp-gtag-src"
            src={`https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(tagId)}`}
            strategy="afterInteractive"
          />
          <Script id="lp-gtag-init" strategy="afterInteractive">
            {`window.dataLayer=window.dataLayer||[];window.gtag=window.gtag||function(){window.dataLayer.push(arguments)};window.gtag('js',new Date());window.gtag('config',${tagLiteral});`}
          </Script>
        </>
      ) : null}
      {hasTrackers && consent === "unset" ? (
        <CookieConsentBanner
          privacyHref={privacyHref}
          onAccept={() => saveLandingConsent("granted")}
          onDecline={() => saveLandingConsent("denied")}
        />
      ) : null}
    </>
  )
}

function runSafely(callback: () => void) {
  try {
    callback()
  } catch {
    // Falha de script de terceiro não pode afetar a confirmação do envio.
  }
}

/**
 * Conversão depois de um envio com sucesso, com o MESMO event_id do payload:
 * `Lead` no Meta Pixel (eventID) e `generate_lead` no gtag (transaction_id).
 * Sem aceite, os scripts não existem e nada é enviado. Nunca envia dados
 * pessoais aos rastreadores.
 */
export function trackLeadConversion({
  eventId,
  interest,
}: {
  eventId: string
  interest?: string | null
}) {
  if (typeof window === "undefined") return

  const trackingWindow = window as TrackingWindow
  const extra = interest ? { lead_interest: interest } : {}

  runSafely(() => trackingWindow.fbq?.("track", "Lead", {}, { eventID: eventId }))
  runSafely(() =>
    trackingWindow.gtag?.("event", "generate_lead", {
      transaction_id: eventId,
      ...extra,
    })
  )
}

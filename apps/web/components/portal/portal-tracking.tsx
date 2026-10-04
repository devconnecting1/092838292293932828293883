"use client"

import Script from "next/script"

import { CookieConsentBanner } from "@/components/leads-publicos/cookie-consent-banner"
import { saveLandingConsent, useLandingConsent } from "@/lib/leads-publicos/consent"
import { toInlineScriptString } from "@/lib/leads-publicos/tracking-ids"

const GTM_PATTERN = /^GTM-[A-Z0-9]{4,12}$/

/**
 * Google Tag Manager do portal público, carregado SÓ depois do aceite de
 * cookies (LGPD). Mesmo aviso e mesmo cookie de consentimento das landing pages.
 *
 * Atenção de segurança: o contêiner do GTM executa o JavaScript que estiver
 * publicado nele. Por isso ele é montado apenas no grupo de rotas do portal
 * (app/(site)), nunca no painel. Recomendação: servir o painel em outro
 * subdomínio (ex.: app.vamosarrematar.com.br) para os cookies de sessão não ficarem
 * na mesma origem do portal.
 */
export function PortalTracking({ gtmId }: { gtmId: string }) {
  const consent = useLandingConsent()
  const valid = GTM_PATTERN.test(gtmId)

  if (!valid) return null

  const literal = toInlineScriptString(gtmId)

  return (
    <>
      {consent === "granted" ? (
        <Script id="portal-gtm" strategy="afterInteractive">
          {`(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src='https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);})(window,document,'script','dataLayer',${literal});`}
        </Script>
      ) : null}
      {consent === "unset" ? (
        <div className="print:hidden">
          <CookieConsentBanner
            privacyHref="/privacidade"
            onAccept={() => saveLandingConsent("granted")}
            onDecline={() => saveLandingConsent("denied")}
          />
        </div>
      ) : null}
    </>
  )
}

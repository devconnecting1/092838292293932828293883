"use client"

import * as React from "react"
import Script from "next/script"

import { CookieConsentBanner } from "@/components/leads-publicos/cookie-consent-banner"
import { toInlineScriptString } from "@/lib/leads-publicos/tracking-ids"

const GTM_PATTERN = /^GTM-[A-Z0-9]{4,12}$/
const COOKIE = "va_consent"
const MAX_AGE = 180 * 24 * 60 * 60

type Escolha = "granted" | "denied" | "unset"

// O cookie das landing pages fica em Path=/lp e não é lido aqui; o portal tem o
// próprio cookie de consentimento, válido em todo o site (Path=/).
const ouvintes = new Set<() => void>()

function ler(): Escolha {
  if (typeof document === "undefined") return "unset"
  const v = document.cookie
    .split(";")
    .map((p) => p.trim())
    .find((p) => p.startsWith(`${COOKIE}=`))
    ?.slice(COOKIE.length + 1)
  return v === "granted" || v === "denied" ? v : "unset"
}

function gravar(escolha: "granted" | "denied") {
  const secure = window.location.protocol === "https:" ? "; Secure" : ""
  document.cookie = `${COOKIE}=${escolha}; Path=/; Max-Age=${MAX_AGE}; SameSite=Lax${secure}`
  for (const o of ouvintes) o()
}

function assinar(o: () => void) {
  ouvintes.add(o)
  return () => {
    ouvintes.delete(o)
  }
}

/**
 * Google Tag Manager do portal público, carregado SÓ depois do aceite de
 * cookies (LGPD).
 *
 * Atenção de segurança: o contêiner do GTM executa o JavaScript que estiver
 * publicado nele. Por isso ele é montado apenas no grupo de rotas do portal
 * (app/(site)), nunca no painel do CRM.
 */
export function PortalTracking({ gtmId }: { gtmId: string }) {
  const consent = React.useSyncExternalStore(assinar, ler, () => null)
  if (!GTM_PATTERN.test(gtmId)) return null
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
            onAccept={() => gravar("granted")}
            onDecline={() => gravar("denied")}
          />
        </div>
      ) : null}
    </>
  )
}

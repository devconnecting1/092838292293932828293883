// Consentimento de cookies de medição (LGPD) das landing pages. Meta Pixel e
// gtag.js só carregam com "granted". A escolha fica no cookie first-party
// `lp_consent` por 180 dias.

import * as React from "react"

import { CONSENT_COOKIE_MAX_AGE_SECONDS, CONSENT_COOKIE_NAME } from "@/lib/leads-publicos/constants"
import { readBrowserCookie, writeBrowserCookie } from "@/lib/leads-publicos/cookies"

export type LandingConsentChoice = "granted" | "denied"

export type LandingConsentState = LandingConsentChoice | "unset"

const listeners = new Set<() => void>()

export function readLandingConsent(): LandingConsentState {
  const value = readBrowserCookie(CONSENT_COOKIE_NAME)
  return value === "granted" || value === "denied" ? value : "unset"
}

function notify() {
  for (const listener of listeners) {
    listener()
  }
}

export function saveLandingConsent(choice: LandingConsentChoice) {
  writeBrowserCookie(CONSENT_COOKIE_NAME, choice, CONSENT_COOKIE_MAX_AGE_SECONDS)
  notify()
}

function subscribe(listener: () => void) {
  listeners.add(listener)

  return () => {
    listeners.delete(listener)
  }
}

function getServerSnapshot() {
  return null
}

/**
 * Escolha atual do visitante. `null` no servidor e na hidratação: nenhum script
 * de terceiro sai no HTML (a página é estática e servida a todos).
 */
export function useLandingConsent(): LandingConsentState | null {
  return React.useSyncExternalStore(subscribe, readLandingConsent, getServerSnapshot)
}

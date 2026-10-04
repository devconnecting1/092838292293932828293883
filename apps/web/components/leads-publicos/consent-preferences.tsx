"use client"

import { Button } from "@workspace/ui/components/button"

import {
  readLandingConsent,
  saveLandingConsent,
  useLandingConsent,
} from "@/lib/leads-publicos/consent"

const STATUS_LABELS = {
  granted: "Você aceitou os cookies de medição.",
  denied: "Você recusou os cookies de medição.",
  unset: "Você ainda não fez uma escolha.",
} as const

/** Troca a escolha de cookies de medição (página de privacidade). */
export function ConsentPreferences() {
  const consent = useLandingConsent()

  function decline() {
    const previous = readLandingConsent()
    saveLandingConsent("denied")

    // Scripts já carregados nesta aba só saem recarregando.
    if (previous === "granted") {
      window.location.reload()
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {/* min-h reserva a linha enquanto a escolha é lida no navegador. */}
      <p className="min-h-5 text-sm text-muted-foreground" aria-live="polite">
        {consent ? STATUS_LABELS[consent] : null}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" disabled={consent === "denied"} onClick={decline}>
          Recusar cookies de medição
        </Button>
        <Button disabled={consent === "granted"} onClick={() => saveLandingConsent("granted")}>
          Aceitar cookies de medição
        </Button>
      </div>
    </div>
  )
}

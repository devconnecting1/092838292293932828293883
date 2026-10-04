"use client"

import { useEffect } from "react"

import { SERVICE_WORKER_URL } from "@/lib/push/client"

/**
 * Registra o service worker do CRM (public/sw.js) nas rotas logadas. O worker
 * só trata push e clique na notificação: não intercepta requisições nem guarda
 * página em cache, então nenhum dado do CRM fica salvo offline.
 */
export function ServiceWorkerRegistration() {
  useEffect(() => {
    if (!("serviceWorker" in navigator) || !window.isSecureContext) {
      return
    }

    navigator.serviceWorker
      .register(SERVICE_WORKER_URL, { scope: "/", updateViaCache: "none" })
      .catch(() => {
        // Sem service worker o CRM funciona igual; só os avisos no celular ficam indisponíveis.
      })
  }, [])

  return null
}

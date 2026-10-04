/*
 * Service worker do CRM Imobiliário.
 *
 * Mínimo de propósito: mostra os avisos no celular (Web Push) e abre o CRM no
 * clique. NÃO tem handler de `fetch`: nenhuma requisição passa por aqui e
 * nenhuma página, resposta de API ou dado pessoal fica em cache offline.
 *
 * Registrado só nas rotas logadas (components/push/service-worker-registration.tsx).
 * Guia seguido: https://nextjs.org/docs/app/guides/progressive-web-apps
 */

const DEFAULT_PATH = "/leads"
const ICON = "/icons/icon-192.png"
const BADGE = "/icons/badge-96.png"

self.addEventListener("install", () => {
  self.skipWaiting()
})

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim())
})

function text(value, fallback, maxLength) {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, maxLength) : fallback
}

/** Só caminhos do próprio CRM: o clique nunca abre endereço de fora. */
function safePath(value) {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//")) {
    return DEFAULT_PATH
  }

  try {
    const url = new URL(value, self.location.origin)
    return url.origin === self.location.origin ? `${url.pathname}${url.search}` : DEFAULT_PATH
  } catch {
    return DEFAULT_PATH
  }
}

function readPayload(event) {
  try {
    const data = event.data ? event.data.json() : null
    return data && typeof data === "object" ? data : {}
  } catch {
    return {}
  }
}

self.addEventListener("push", (event) => {
  const data = readPayload(event)
  const title = text(data.title, "CRM Imobiliário", 120)
  const tag = text(data.tag, "", 80)

  event.waitUntil(
    self.registration.showNotification(title, {
      body: text(data.body, "Você tem um novo aviso no CRM.", 240),
      icon: ICON,
      badge: BADGE,
      lang: "pt-BR",
      dir: "ltr",
      tag: tag || undefined,
      // Aviso novo do mesmo lead substitui o anterior e toca de novo.
      renotify: Boolean(tag),
      data: { path: safePath(data.url) },
    })
  )
})

self.addEventListener("notificationclick", (event) => {
  event.notification.close()

  const path = safePath(event.notification.data && event.notification.data.path)
  const target = new URL(path, self.location.origin).href

  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true })

      for (const client of windows) {
        if (client.url === target && "focus" in client) {
          return client.focus()
        }
      }

      return self.clients.openWindow(target)
    })()
  )
})

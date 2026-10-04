"use client"

import { Analytics } from "@vercel/analytics/next"
import { SpeedInsights } from "@vercel/speed-insights/next"

/**
 * Rotas que nunca geram evento: o caminho carrega token de convite, fluxo de
 * autenticação ou o slug do feed de portais. Vale com e sem barra final.
 */
const IGNORED_PATH_PREFIXES = ["/convite", "/auth", "/api/feeds"]

function isIgnoredPath(pathname: string) {
  return IGNORED_PATH_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  )
}

/**
 * LGPD: o Web Analytics não usa cookies, e aqui também não sai dado pessoal pela URL.
 * Remove a query string e o fragmento (#access_token do Supabase, utm com e-mail etc.)
 * de todos os eventos e descarta as rotas sensíveis. Nas landing pages (/lp/...) o
 * caminho é mantido, só sem a query.
 */
function redactEvent<T extends { url: string }>(event: T): T | null {
  let url: URL
  try {
    url = new URL(event.url)
  } catch {
    return null
  }

  if (isIgnoredPath(url.pathname)) {
    return null
  }

  return { ...event, url: `${url.origin}${url.pathname}` }
}

/** Vercel Web Analytics e Speed Insights (renderizados só em produção pelo layout raiz). */
function VercelObservability() {
  return (
    <>
      <Analytics beforeSend={redactEvent} />
      <SpeedInsights beforeSend={redactEvent} />
    </>
  )
}

export { VercelObservability }

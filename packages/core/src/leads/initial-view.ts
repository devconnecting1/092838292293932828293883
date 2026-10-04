/**
 * Visão inicial da tela de Leads escolhida no servidor, antes de qualquer
 * JavaScript: lista (cartões) no celular e quadro no computador, para o quadro
 * não piscar no celular antes da troca.
 *
 * Módulo puro. Ordem dos sinais:
 * 1. `Sec-CH-UA-Mobile` (dica de cliente de baixa entropia, enviada por padrão
 *    pelos navegadores Chromium em HTTPS, sem `Accept-CH`): "?1" celular, "?0" não.
 *    https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Sec-CH-UA-Mobile
 * 2. Sem a dica (Safari, Firefox), o User-Agent: o MDN recomenda procurar `Mobi`
 *    e não deduzir o aparelho pelo sistema (Android também roda em tablet).
 *    https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/Browser_detection_using_the_user_agent
 *
 * É só um palpite para o primeiro desenho: a escolha explícita (`?visao=`) sempre vale.
 */

export const LEAD_VIEW_PARAM = "visao"

export type LeadInitialView = "quadro" | "lista"

export type LeadRequestHints = {
  /** Valor do cabeçalho `Sec-CH-UA-Mobile`, se veio. */
  secChUaMobile?: string | null
  /** Valor do cabeçalho `User-Agent`, se veio. */
  userAgent?: string | null
}

/**
 * Telefones: Chrome, Samsung Internet e Firefox no Android trazem `Mobile`
 * (tablets não); o Safari do iPhone traz `iPhone` e `Mobile`. Não usar só
 * `Android`: o tablet ficaria preso na lista ao escolher o quadro.
 */
const MOBILE_USER_AGENT = /Mobi|iPhone|iPod/i

export function isLeadInitialView(value: unknown): value is LeadInitialView {
  return value === "quadro" || value === "lista"
}

/** O pedido veio de um celular? A dica de cliente, quando existe, decide sozinha. */
export function isMobileRequest({ secChUaMobile, userAgent }: LeadRequestHints) {
  const hint = secChUaMobile?.trim()

  if (hint === "?1") return true
  if (hint === "?0") return false

  return MOBILE_USER_AGENT.test(userAgent ?? "")
}

/** Visão padrão para o aparelho do pedido: lista no celular, quadro no computador. */
export function defaultLeadViewForRequest(hints: LeadRequestHints): LeadInitialView {
  return isMobileRequest(hints) ? "lista" : "quadro"
}

/** Visão pedida no endereço (`?visao=`) ou, sem ela (ou inválida), a padrão do aparelho. */
export function resolveLeadView(
  requested: string | string[] | null | undefined,
  fallback: LeadInitialView
): LeadInitialView {
  const value = Array.isArray(requested) ? requested[0] : requested
  return isLeadInitialView(value) ? value : fallback
}

/**
 * Mesmo endereço com `visao` explícita (substitui a que houver e mantém os demais
 * parâmetros), para a visão atual não se perder quando o padrão do servidor é outro.
 */
export function withLeadView(href: string, view: LeadInitialView) {
  const queryStart = href.indexOf("?")
  const path = queryStart === -1 ? href : href.slice(0, queryStart)
  const params = new URLSearchParams(queryStart === -1 ? "" : href.slice(queryStart + 1))

  params.set(LEAD_VIEW_PARAM, view)

  return `${path}?${params.toString()}`
}

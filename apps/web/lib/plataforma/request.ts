import "server-only"

/**
 * Proteção contra envio de outro site (CSRF) nas rotas internas que recebem
 * POST com a sessão. Mesma regra que o Next aplica às Server Actions: o host do
 * cabeçalho `Origin` precisa ser o host da própria requisição
 * (`x-forwarded-host` ou `host`). Sem `Origin`, recusa. Quando o navegador
 * manda `Sec-Fetch-Site`, ele também precisa dizer `same-origin`.
 */
export function isSameOriginRequest(request: Request): boolean {
  const origin = request.headers.get("origin")
  const host = (request.headers.get("x-forwarded-host") ?? request.headers.get("host"))
    ?.split(",")[0]
    ?.trim()
    .toLowerCase()

  if (!origin || !host) {
    return false
  }

  const fetchSite = request.headers.get("sec-fetch-site")

  if (fetchSite && fetchSite !== "same-origin") {
    return false
  }

  try {
    return new URL(origin).host.toLowerCase() === host
  } catch {
    return false
  }
}

/**
 * Cadastro incorporado do WhatsApp (Embedded Signup): a janela da Meta devolve
 * o resultado por `postMessage`. Só vale mensagem de origem HTTPS cujo host seja
 * `facebook.com` ou um subdomínio dele.
 *
 * Comparar com `origin.endsWith("facebook.com")` não basta: aceitaria
 * `https://evilfacebook.com` ou `https://facebook.com.example`. Aqui o host é
 * lido pela URL e comparado por inteiro ou com o ponto antes do domínio.
 */
export const META_MESSAGE_ROOT_DOMAIN = "facebook.com"

/**
 * Origens exatas de onde a janela da Meta costuma responder. O handler confere
 * primeiro esta lista (comparação direta, reconhecida pelo CodeQL) e só depois
 * a regra de subdomínio de `isMetaMessageOrigin`, que continua segura.
 */
export const META_MESSAGE_ORIGINS: readonly string[] = [
  "https://www.facebook.com",
  "https://web.facebook.com",
  "https://business.facebook.com",
]

export function isMetaMessageOrigin(origin: unknown): boolean {
  if (typeof origin !== "string" || origin.length === 0) {
    return false
  }

  let url: URL

  try {
    url = new URL(origin)
  } catch {
    return false
  }

  if (url.protocol !== "https:" || url.port !== "" || url.username || url.password) {
    return false
  }

  const host = url.hostname.toLowerCase()

  return host === META_MESSAGE_ROOT_DOMAIN || host.endsWith(`.${META_MESSAGE_ROOT_DOMAIN}`)
}

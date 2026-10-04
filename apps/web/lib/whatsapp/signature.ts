import "server-only"

import { createHmac, timingSafeEqual } from "node:crypto"

import { parseHubSignature } from "@workspace/core/whatsapp"

/**
 * Verificação da assinatura do webhook da Meta.
 *
 * `X-Hub-Signature-256: sha256={hex}` é o HMAC-SHA256 do CORPO BRUTO com o app
 * secret. Duas regras que não podem ser afrouxadas:
 *
 *   1. O corpo tem de ser exatamente o que chegou. Qualquer `JSON.parse` +
 *      `JSON.stringify` antes daqui muda bytes (ordem de chaves, escapes,
 *      espaços) e invalida a assinatura — e, pior, faria a rota trabalhar com
 *      um corpo que ela ainda não sabe que é genuíno.
 *   2. A comparação é em tempo constante. Comparar hex com `===` vaza, pelo
 *      tempo, o prefixo correto e permite forjar a assinatura byte a byte.
 */
export function verifyMetaSignature(
  rawBody: string,
  header: string | null | undefined,
  appSecret: string
): boolean {
  const received = parseHubSignature(header)

  if (!received || !appSecret) {
    return false
  }

  const expected = createHmac("sha256", appSecret).update(rawBody, "utf8").digest("hex")

  const a = Buffer.from(expected, "hex")
  const b = Buffer.from(received, "hex")

  // parseHubSignature já garante 64 caracteres hexadecimais, mas timingSafeEqual
  // lança quando os tamanhos diferem: a checagem fica explícita.
  if (a.length !== b.length) {
    return false
  }

  return timingSafeEqual(a, b)
}

/**
 * Comparação em tempo constante do `hub.verify_token` da verificação inicial
 * (GET). Mesma razão da assinatura: `===` em segredo vaza pelo tempo.
 */
export function verifyTokenMatches(received: string | null, expected: string): boolean {
  if (!received || !expected) {
    return false
  }

  const a = createHmac("sha256", "meta-verify-token").update(received).digest()
  const b = createHmac("sha256", "meta-verify-token").update(expected).digest()

  return timingSafeEqual(a, b)
}

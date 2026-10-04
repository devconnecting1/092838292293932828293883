import "server-only"

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto"

/**
 * Antirrobô do formulário público, sem dependências:
 * - o servidor emite um token `emitidoEm.assinatura` (HMAC-SHA256 do slug + horário);
 * - no envio, rejeita token adulterado, muito antigo ou enviado rápido demais.
 *
 * Chave: CAPTURE_FORM_SECRET (ou NEXT_SERVER_ACTIONS_ENCRYPTION_KEY), derivada
 * com HMAC para este uso. Sem nenhuma das duas, usa uma chave aleatória do
 * processo — funciona com uma instância só; em produção com várias instâncias
 * defina CAPTURE_FORM_SECRET.
 */

export const MIN_FILL_MS = 3000
const MAX_TOKEN_AGE_MS = 12 * 60 * 60 * 1000
const KEY_LABEL = "captar-form-token:v1"

type GlobalWithKey = typeof globalThis & { __captarFormKey?: Buffer }

function getSigningKey() {
  const secret =
    process.env.CAPTURE_FORM_SECRET?.trim() ||
    process.env.NEXT_SERVER_ACTIONS_ENCRYPTION_KEY?.trim()

  if (secret) {
    return createHmac("sha256", secret).update(KEY_LABEL).digest()
  }

  // Guardada no globalThis para sobreviver ao recarregamento de módulos em dev.
  const store = globalThis as GlobalWithKey
  store.__captarFormKey ??= randomBytes(32)
  return store.__captarFormKey
}

function sign(slug: string, issuedAt: string) {
  return createHmac("sha256", getSigningKey()).update(`${slug}.${issuedAt}`).digest("base64url")
}

export function issueFormToken(slug: string, now: number = Date.now()) {
  const issuedAt = String(now)
  return `${issuedAt}.${sign(slug, issuedAt)}`
}

export type FormTokenCheck = "ok" | "too-fast" | "invalid" | "expired"

export function checkFormToken(
  token: unknown,
  slug: string,
  now: number = Date.now()
): FormTokenCheck {
  if (typeof token !== "string" || token.length > 200) {
    return "invalid"
  }

  const [issuedAt, signature, ...rest] = token.split(".")

  if (!issuedAt || !signature || rest.length > 0 || !/^\d{13}$/.test(issuedAt)) {
    return "invalid"
  }

  const expected = Buffer.from(sign(slug, issuedAt))
  const received = Buffer.from(signature)

  if (expected.length !== received.length || !timingSafeEqual(expected, received)) {
    return "invalid"
  }

  const elapsed = now - Number(issuedAt)

  if (elapsed < 0 || elapsed > MAX_TOKEN_AGE_MS) {
    return "expired"
  }

  return elapsed < MIN_FILL_MS ? "too-fast" : "ok"
}

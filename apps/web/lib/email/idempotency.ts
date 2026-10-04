import "server-only"

import { createHash } from "node:crypto"

/**
 * idempotencyKey determinístico no formato UUID (a Brevo exige UUID) a partir
 * das partes que identificam o envio, ex.: ("new_lead", leadId, destinatário).
 * A mesma notificação disparada de novo em até 30 min não gera e-mail duplicado.
 * O destinatário entra só no hash (SHA-256), que vai apenas para a Brevo.
 */
export function deriveIdempotencyKey(...parts: readonly (string | null | undefined)[]): string {
  const hex = createHash("sha256").update(JSON.stringify(parts)).digest("hex")
  const variant = ((Number.parseInt(hex.charAt(16), 16) & 0x3) | 0x8).toString(16)

  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    `4${hex.slice(13, 16)}`,
    `${variant}${hex.slice(17, 20)}`,
    hex.slice(20, 32),
  ].join("-")
}

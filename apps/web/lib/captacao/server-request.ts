import "server-only"

import { createHmac, randomUUID } from "node:crypto"
import { headers } from "next/headers"

/**
 * Proteções exigidas pelas RPCs públicas chamadas pelo servidor Next com a
 * chave publishable (ex.: submit_capture_request):
 * - chave do servidor (segredo do Supabase Vault, só em variável de ambiente);
 * - nonce novo a cada envio;
 * - hash do visitante (HMAC-SHA256 do IP), nunca o IP em claro.
 */

/** Variáveis com as chaves do servidor das RPCs públicas (segredos do Vault). */
export type ServerKeyEnvName = "CAPTURE_SERVER_KEY" | "LEAD_SERVER_KEY"

/**
 * Lê a chave do servidor do ambiente. Se estiver ausente, registra só o nome
 * da variável (nunca valores) e devolve null: quem chama responde com um erro
 * genérico ao visitante.
 */
export function readServerKey(name: ServerKeyEnvName): string | null {
  const value = process.env[name]?.trim()

  if (!value) {
    console.error(`${name} ausente`)
    return null
  }

  return value
}

/** Nonce de uso único por envio (a RPC aceita 16 a 512 caracteres visíveis). */
export function createRequestNonce(): string {
  return randomUUID()
}

const MAX_IP_LENGTH = 256

/** IP do visitante: primeiro valor de x-forwarded-for; senão x-real-ip. */
export function readVisitorIp(headerList: Pick<Headers, "get">): string | null {
  const forwarded = headerList.get("x-forwarded-for")?.split(",")[0]?.trim()
  const ip = forwarded || headerList.get("x-real-ip")?.trim()

  if (!ip || ip.length > MAX_IP_LENGTH) {
    return null
  }

  return ip.toLowerCase()
}

/**
 * HMAC-SHA256 (hex, 64 caracteres) do IP com CAPTURE_FORM_SECRET como chave.
 * Sem o segredo ou sem IP devolve null (p_client_key é opcional na RPC).
 */
export function hashVisitorIp(ip: string | null | undefined): string | null {
  const secret = process.env.CAPTURE_FORM_SECRET?.trim()

  if (!secret || !ip) {
    return null
  }

  return createHmac("sha256", secret).update(ip).digest("hex")
}

/** Hash do visitante da requisição atual (para p_client_key). */
export async function getVisitorClientKey(): Promise<string | null> {
  const headerList = await headers()
  return hashVisitorIp(readVisitorIp(headerList))
}

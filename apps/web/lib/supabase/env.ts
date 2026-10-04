// Leitura das variáveis públicas do Supabase. Sem `server-only`: o navegador também usa
// (URL pública de imagens e envio por URL assinada, sem sessão).
// As referências precisam ser literais (process.env.NEXT_PUBLIC_...) para o Next.js inlinar os valores.

export type SupabaseEnv = {
  url: string
  publishableKey: string
}

export type SupabaseEnvStatus = {
  hasUrl: boolean
  isUrlValid: boolean
  hasPublishableKey: boolean
  usesLegacyAnonKey: boolean
}

function isHttpUrl(value: string) {
  try {
    const url = new URL(value)
    return url.protocol === "https:" || url.protocol === "http:"
  } catch {
    return false
  }
}

function readEnv() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? ""
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim() ?? ""
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() ?? ""

  return { url, publishableKey, anonKey }
}

export function getSupabaseEnvStatus(): SupabaseEnvStatus {
  const { url, publishableKey, anonKey } = readEnv()

  return {
    hasUrl: url.length > 0,
    isUrlValid: isHttpUrl(url),
    hasPublishableKey: publishableKey.length > 0 || anonKey.length > 0,
    usesLegacyAnonKey: publishableKey.length === 0 && anonKey.length > 0,
  }
}

export function getSupabaseEnv(): SupabaseEnv | null {
  const { url, publishableKey, anonKey } = readEnv()
  const key = publishableKey || anonKey

  if (!url || !key || !isHttpUrl(url)) {
    return null
  }

  return { url, publishableKey: key }
}

export function isSupabaseConfigured() {
  return getSupabaseEnv() !== null
}

export class SupabaseNotConfiguredError extends Error {
  constructor() {
    super(
      "Supabase não configurado: defina NEXT_PUBLIC_SUPABASE_URL e NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY em apps/web/.env.local."
    )
    this.name = "SupabaseNotConfiguredError"
  }
}

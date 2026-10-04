import "server-only"

// Segredos do servidor das contas conectadas. Nenhum deles pode ganhar prefixo
// NEXT_PUBLIC_ nem aparecer em log: as funções abaixo devolvem o valor ou
// `null`, e quem chama registra só o fato de faltar.

const warned = new Set<string>()

function warnOnce(name: string, message: string) {
  if (warned.has(name)) {
    return
  }

  warned.add(name)
  console.warn(message)
}

/** Chave do segredo `connections_server_key` do Vault (env CONNECTIONS_SERVER_KEY). */
export function readConnectionsServerKey(): string | null {
  const value = process.env.CONNECTIONS_SERVER_KEY?.trim()

  if (!value) {
    warnOnce(
      "CONNECTIONS_SERVER_KEY",
      "[conexoes] CONNECTIONS_SERVER_KEY ausente: contas conectadas e WhatsApp desativados"
    )
    return null
  }

  return value
}

/** App secret da Meta. Usado só para assinar a troca do code e conferir webhook. */
export function readMetaAppSecret(): string | null {
  const value = process.env.META_APP_SECRET?.trim()

  if (!value) {
    warnOnce("META_APP_SECRET", "[conexoes] META_APP_SECRET ausente: webhook do WhatsApp recusado")
    return null
  }

  return value
}

/**
 * Token que a Meta devolve na verificação do webhook (GET com hub.verify_token).
 * Sem ele a rota responde 404 para o GET: melhor a Meta não conseguir verificar
 * do que verificarmos contra string vazia.
 */
export function readMetaWebhookVerifyToken(): string | null {
  const value = process.env.META_WEBHOOK_VERIFY_TOKEN?.trim()

  if (!value || value.length < 16) {
    warnOnce(
      "META_WEBHOOK_VERIFY_TOKEN",
      "[conexoes] META_WEBHOOK_VERIFY_TOKEN ausente ou curto demais: verificação do webhook desativada"
    )
    return null
  }

  return value
}

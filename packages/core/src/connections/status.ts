// Situação de uma conta conectada, como a tela conta a história.
//
// Três eixos separados de propósito — juntá-los num único "ativo/inativo" é o
// que faz a interface mentir:
//   1. `status`   — o que o fornecedor diz da conexão (conectada, com erro, revogada);
//   2. `enabled`  — o interruptor da imobiliária (desligar sem apagar);
//   3. `blocked`  — o interruptor da plataforma (nossa sobrevivência; o cliente
//                   vê, mas não desfaz).
//
// Espelho no banco: enum `public.connection_status` e as colunas `enabled`,
// `blocked_at` de `public.connected_accounts`.

export const CONNECTION_STATUSES = ["pending", "connected", "error", "revoked"] as const

export type ConnectionStatus = (typeof CONNECTION_STATUSES)[number]

export function isConnectionStatus(value: unknown): value is ConnectionStatus {
  return (
    typeof value === "string" &&
    (CONNECTION_STATUSES as readonly string[]).includes(value as ConnectionStatus)
  )
}

/** Como a conexão aparece para o usuário, já combinando os três eixos. */
export type ConnectionHealth =
  "not_connected" | "pending" | "active" | "paused" | "blocked" | "error" | "revoked"

export type ConnectionHealthInput = {
  status: ConnectionStatus | null
  enabled: boolean
  blockedAt: string | null
}

export function connectionHealth(input: ConnectionHealthInput | null): ConnectionHealth {
  if (!input || input.status === null) {
    return "not_connected"
  }

  // O bloqueio da plataforma vence tudo: se estamos em risco, não há tela que
  // possa mostrar "ativo".
  if (input.blockedAt) {
    return "blocked"
  }

  if (input.status === "revoked") {
    return "revoked"
  }

  if (input.status === "error") {
    return "error"
  }

  if (input.status === "pending") {
    return "pending"
  }

  return input.enabled ? "active" : "paused"
}

export const CONNECTION_HEALTH_LABELS: Record<ConnectionHealth, string> = {
  not_connected: "Não conectado",
  pending: "Conexão incompleta",
  active: "Conectado",
  paused: "Desligado pela imobiliária",
  blocked: "Suspenso pela plataforma",
  error: "Com erro",
  revoked: "Acesso revogado",
}

/**
 * Frase abaixo do selo. Vale para todo provedor, então descreve só a conexão e
 * nunca promete uso: a caixa de conversas do WhatsApp ainda não existe, e dizer
 * "enviando e recebendo" com a conta apenas conectada seria mentir na tela.
 */
export const CONNECTION_HEALTH_HINTS: Record<ConnectionHealth, string> = {
  not_connected: "A imobiliária ainda não conectou a conta dela neste serviço.",
  pending: "O fornecedor devolveu a conta, mas faltam passos para ela funcionar.",
  active: "Conta conectada e ligada.",
  paused:
    "Continua conectada e com o histórico intacto; enquanto estiver desligada, a plataforma não envia nada por ela.",
  blocked: "Suspensa por segurança da plataforma. Fale com o suporte para reativar.",
  error: "O fornecedor recusou a última chamada. Reconecte a conta.",
  revoked: "A autorização foi retirada no fornecedor. É preciso conectar de novo.",
}

/** Só uma conexão saudável e ligada pode enviar. Receber nunca é bloqueado. */
export function canSendThroughConnection(input: ConnectionHealthInput | null): boolean {
  return connectionHealth(input) === "active"
}

export const CONNECTION_EVENT_ACTIONS = [
  "connected",
  "reconnected",
  "enabled",
  "disabled",
  "blocked",
  "unblocked",
  "terms_accepted",
  "disconnected",
  "error",
] as const

export type ConnectionEventAction = (typeof CONNECTION_EVENT_ACTIONS)[number]

export const CONNECTION_EVENT_LABELS: Record<ConnectionEventAction, string> = {
  connected: "Conectou a conta",
  reconnected: "Reconectou a conta",
  enabled: "Ligou a conexão",
  disabled: "Desligou a conexão",
  blocked: "Suspensa pela plataforma",
  unblocked: "Suspensão removida",
  terms_accepted: "Aceitou os termos do fornecedor",
  disconnected: "Desconectou a conta",
  error: "Erro registrado pelo fornecedor",
}

export function isConnectionEventAction(value: unknown): value is ConnectionEventAction {
  return (
    typeof value === "string" &&
    (CONNECTION_EVENT_ACTIONS as readonly string[]).includes(value as ConnectionEventAction)
  )
}

// WhatsApp Cloud API: constantes do protocolo e tradução honesta de estado.
//
// Tudo aqui foi conferido na documentação oficial da Meta em 16/09/2026
// (developers.facebook.com/documentation/business-messaging/whatsapp). Ao
// mexer em qualquer constante, confira a página citada no comentário — a Meta
// deprecia campo sem aviso e a interface não pode passar a mentir por isso.
//
// Módulo puro (sem I/O). O espelho no banco são os enums
// `public.whatsapp_message_status` e `public.whatsapp_quality_rating` da
// migração `whatsapp_channel`.

/**
 * Versão da Graph API. v26.0 saiu em 29/07/2026.
 * https://developers.facebook.com/docs/graph-api/guides/versioning
 */
export const WHATSAPP_GRAPH_VERSION = "v26.0"

export const WHATSAPP_GRAPH_BASE_URL = "https://graph.facebook.com"

/** Data em que estas constantes foram conferidas na documentação da Meta. */
export const WHATSAPP_PROTOCOL_CHECKED_AT = "2026-09-16"

/**
 * Janela de atendimento. "When a WhatsApp user messages you or calls you, a
 * 24-hour timer called a customer service window starts. If the user messages
 * or calls you again before the timer expires, the timer resets."
 * https://developers.facebook.com/documentation/business-messaging/whatsapp/messages/send-messages
 */
export const WHATSAPP_SERVICE_WINDOW_HOURS = 24

/** Janela gratuita do free entry point (anúncio Click-to-WhatsApp / CTA de Página). */
export const WHATSAPP_FREE_ENTRY_POINT_WINDOW_HOURS = 72

/** Limite de caracteres do corpo de uma mensagem de texto. */
export const WHATSAPP_TEXT_MAX_LENGTH = 4096

// ---------------------------------------------------------------------------
// Estado da mensagem — "enviado" nunca é "entregue"
// ---------------------------------------------------------------------------

/**
 * Estados que guardamos. Os cinco do meio vêm da Meta; `queued` e `discarded`
 * são nossos:
 *
 * - `queued`    — está na nossa fila; a Meta ainda não viu.
 * - `accepted`  — a API devolveu um `wamid`. A própria Meta avisa: "This
 *                 response only indicates that the API successfully accepted
 *                 your request — it does not indicate successful delivery".
 * - `held`      — template retido para avaliação de qualidade
 *                 (`message_status: "held_for_quality_assessment"`).
 * - `sent`      — webhook `sent`: saiu dos servidores do WhatsApp.
 * - `delivered` — webhook `delivered`: chegou ao aparelho. **Só aqui existe entrega.**
 * - `read`      — webhook `read`.
 * - `played`    — webhook `played` (áudio ouvido pela primeira vez).
 * - `failed`    — webhook `failed`, com o código de erro da Meta.
 * - `discarded` — mensagem retida que a Meta DESCARTOU (erro 132015) ou que
 *                 estourou o TTL. Não volta para a fila: reenviar é decisão
 *                 humana.
 *
 * https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/reference/messages/status
 * https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/template-pacing
 */
export const WHATSAPP_MESSAGE_STATUSES = [
  "queued",
  "accepted",
  "held",
  "sent",
  "delivered",
  "read",
  "played",
  "failed",
  "discarded",
] as const

export type WhatsappMessageStatus = (typeof WHATSAPP_MESSAGE_STATUSES)[number]

export function isWhatsappMessageStatus(value: unknown): value is WhatsappMessageStatus {
  return (
    typeof value === "string" &&
    (WHATSAPP_MESSAGE_STATUSES as readonly string[]).includes(value as WhatsappMessageStatus)
  )
}

/** Ordem de progresso. Um webhook atrasado nunca pode fazer o estado andar para trás. */
const STATUS_RANK: Record<WhatsappMessageStatus, number> = {
  queued: 0,
  held: 1,
  accepted: 2,
  sent: 3,
  delivered: 4,
  read: 5,
  played: 6,
  failed: 7,
  discarded: 8,
}

/** Estados finais: chegaram ao fim da linha e não avançam mais. */
const TERMINAL: readonly WhatsappMessageStatus[] = ["failed", "discarded"]

/**
 * Qual estado vale quando chega um webhook. Regras:
 * 1. `failed`/`discarded` são finais — nenhum webhook posterior os desfaz.
 * 2. Fora isso, vence o estado mais adiantado (webhooks chegam fora de ordem).
 */
export function mergeWhatsappStatus(
  current: WhatsappMessageStatus,
  incoming: WhatsappMessageStatus
): WhatsappMessageStatus {
  if (TERMINAL.includes(current)) {
    return current
  }

  if (TERMINAL.includes(incoming)) {
    return incoming
  }

  return STATUS_RANK[incoming] > STATUS_RANK[current] ? incoming : current
}

/**
 * Rótulos da tela. A regra que manda: NUNCA dizer "Entregue" antes do webhook
 * `delivered`, e nunca dizer "Enviada" enquanto a Meta só aceitou o pedido.
 */
export const WHATSAPP_MESSAGE_STATUS_LABELS: Record<WhatsappMessageStatus, string> = {
  queued: "Na fila",
  accepted: "Aceita pela Meta",
  held: "Retida pela Meta",
  sent: "Enviada",
  delivered: "Entregue",
  read: "Lida",
  played: "Ouvida",
  failed: "Falhou",
  discarded: "Descartada pela Meta",
}

export const WHATSAPP_MESSAGE_STATUS_HINTS: Record<WhatsappMessageStatus, string> = {
  queued: "Ainda não saiu daqui.",
  accepted: "A Meta recebeu o pedido. Isso não é entrega: espere a confirmação.",
  held: "A Meta segurou a mensagem para avaliar a qualidade do modelo. Pode ser descartada.",
  sent: "Saiu dos servidores do WhatsApp. Ainda não chegou ao aparelho.",
  delivered: "Chegou ao aparelho do contato.",
  read: "O contato abriu a mensagem.",
  played: "O contato ouviu o áudio.",
  failed: "A Meta recusou a entrega.",
  discarded: "A Meta descartou a mensagem. Ela não será reenviada sozinha.",
}

/** Só isto é entrega. Usado por qualquer contador de "entregues" da tela. */
export function whatsappMessageDelivered(status: WhatsappMessageStatus): boolean {
  return status === "delivered" || status === "read" || status === "played"
}

/** Saiu daqui, mas ainda não há prova de entrega. */
export function whatsappMessageInFlight(status: WhatsappMessageStatus): boolean {
  return status === "queued" || status === "accepted" || status === "held" || status === "sent"
}

export function whatsappMessageFailed(status: WhatsappMessageStatus): boolean {
  return status === "failed" || status === "discarded"
}

// ---------------------------------------------------------------------------
// Erros que o produto precisa tratar por nome
// ---------------------------------------------------------------------------

export type WhatsappErrorHandling =
  /** Não reenviar nunca para este contato nesta finalidade. Vai para a supressão. */
  | "suppress"
  /** Esperar antes de tentar de novo; não é culpa do conteúdo. */
  | "backoff"
  /** Problema do modelo/conteúdo: alguém precisa consertar antes de reenviar. */
  | "fix_content"
  /** Problema de conexão/credencial: reconectar a conta. */
  | "reconnect"
  /** Sem tratamento especial. */
  | "generic"

export type WhatsappErrorDefinition = {
  code: number
  /** Título da Meta, em inglês, como vem no webhook. */
  metaTitle: string
  /** O que dizer ao corretor, em português, sem jargão. */
  message: string
  handling: WhatsappErrorHandling
  /** `true` quando a mensagem foi descartada e não será reenviada pela Meta. */
  dropped: boolean
}

/**
 * Tabela oficial:
 * https://developers.facebook.com/documentation/business-messaging/whatsapp/support/error-codes
 */
export const WHATSAPP_ERRORS: Record<number, WhatsappErrorDefinition> = {
  131049: {
    code: 131049,
    metaTitle: "This message was not delivered to maintain healthy ecosystem engagement.",
    message:
      "A Meta não entregou: este contato já recebeu muitas mensagens de divulgação. Espere pelo menos 24 horas antes de tentar de novo.",
    handling: "backoff",
    dropped: true,
  },
  131050: {
    code: 131050,
    metaTitle:
      "Unable to deliver the message. This recipient has chosen to stop receiving marketing messages on WhatsApp from your business.",
    message:
      "O contato desligou 'Ofertas e avisos' no WhatsApp desta imobiliária. Não é possível enviar divulgação para ele.",
    handling: "suppress",
    dropped: true,
  },
  132015: {
    code: 132015,
    metaTitle: "Template is paused due to low quality so it cannot be sent in a template message.",
    message:
      "O modelo foi pausado pela Meta por baixa qualidade. As mensagens que estavam retidas foram DESCARTADAS — elas não são reenviadas sozinhas. Ajuste o modelo e reenvie manualmente.",
    handling: "fix_content",
    dropped: true,
  },
  131047: {
    code: 131047,
    metaTitle:
      "Message failed to send because more than 24 hours have passed since the customer last replied to this number.",
    message:
      "A janela de 24 horas fechou. Só é possível enviar por um modelo aprovado — e, se for divulgação, com autorização registrada.",
    handling: "fix_content",
    dropped: true,
  },
  131026: {
    code: 131026,
    metaTitle: "Message Undeliverable.",
    message: "Não foi possível entregar: o número pode não ter WhatsApp ou não aceita este envio.",
    handling: "generic",
    dropped: true,
  },
  190: {
    code: 190,
    metaTitle: "Access token has expired.",
    message:
      "A autorização da conta na Meta expirou. Reconecte a conta em Configurações › Conexões.",
    handling: "reconnect",
    dropped: false,
  },
  131031: {
    code: 131031,
    metaTitle: "Business Account is restricted from messaging users in this country.",
    message: "A conta da imobiliária está restrita pela Meta. Verifique o painel da Meta.",
    handling: "reconnect",
    dropped: true,
  },
  368: {
    code: 368,
    metaTitle: "Temporarily blocked for policies violations.",
    message:
      "A Meta bloqueou temporariamente o número por violação de política. O envio fica suspenso até a Meta liberar.",
    handling: "reconnect",
    dropped: true,
  },
  80007: {
    code: 80007,
    metaTitle: "Rate limit issues.",
    message: "Muitos envios em pouco tempo. Aguarde e tente de novo.",
    handling: "backoff",
    dropped: false,
  },
}

export function whatsappError(code: number | null | undefined): WhatsappErrorDefinition | null {
  if (typeof code !== "number" || !Number.isFinite(code)) {
    return null
  }

  return WHATSAPP_ERRORS[code] ?? null
}

/** Erros que, sozinhos, mandam o contato para a lista de supressão do tenant. */
export function whatsappErrorSuppresses(code: number | null | undefined): boolean {
  return whatsappError(code)?.handling === "suppress"
}

// ---------------------------------------------------------------------------
// Preferência de marketing do contato (webhook `user_preferences`)
// ---------------------------------------------------------------------------

/**
 * O contato desligando "Ofertas e avisos" chega pelo webhook field
 * `user_preferences`, com `category: "marketing_messages"` e `value: "stop"`
 * ou `"resume"`. Não existe endpoint para consultar essa preferência: o estado
 * só chega por webhook e tem de ser guardado por tenant.
 * https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/reference/user_preferences
 */
export const WHATSAPP_USER_PREFERENCE_FIELD = "user_preferences"
export const WHATSAPP_MARKETING_CATEGORY = "marketing_messages"

export const WHATSAPP_USER_PREFERENCE_VALUES = ["stop", "resume"] as const

export type WhatsappUserPreferenceValue = (typeof WHATSAPP_USER_PREFERENCE_VALUES)[number]

export function isWhatsappUserPreferenceValue(
  value: unknown
): value is WhatsappUserPreferenceValue {
  return value === "stop" || value === "resume"
}

// ---------------------------------------------------------------------------
// Saúde do número
// ---------------------------------------------------------------------------

/** `GREEN` confirmado na doc; os demais são os valores conhecidos da API. */
export const WHATSAPP_QUALITY_RATINGS = ["GREEN", "YELLOW", "RED", "UNKNOWN"] as const

export type WhatsappQualityRating = (typeof WHATSAPP_QUALITY_RATINGS)[number]

export function isWhatsappQualityRating(value: unknown): value is WhatsappQualityRating {
  return (
    typeof value === "string" &&
    (WHATSAPP_QUALITY_RATINGS as readonly string[]).includes(value as WhatsappQualityRating)
  )
}

export const WHATSAPP_QUALITY_LABELS: Record<WhatsappQualityRating, string> = {
  GREEN: "Boa",
  YELLOW: "Em atenção",
  RED: "Ruim",
  UNKNOWN: "Sem avaliação",
}

/**
 * Qualidade em que o envio é suspenso automaticamente. `RED` significa que os
 * bloqueios e denúncias dos últimos 7 dias já derrubaram o número; continuar
 * disparando é o caminho mais curto para o desligamento — e, pelos Tech
 * Provider Terms §2.1, a conduta do cliente também é nossa.
 */
export function whatsappQualityRequiresSuspension(rating: WhatsappQualityRating): boolean {
  return rating === "RED"
}

/**
 * Limite de envio. `messaging_limit_tier` foi DEPRECIADO pela Meta; o campo
 * vigente é `whatsapp_business_manager_messaging_limit` e o limite é do
 * PORTFÓLIO, compartilhado por todos os números dele — mais uma razão para
 * cada imobiliária ter o portfólio dela.
 * https://developers.facebook.com/documentation/business-messaging/whatsapp/messaging-limits
 */
export const WHATSAPP_MESSAGING_LIMIT_FIELD = "whatsapp_business_manager_messaging_limit"

export const WHATSAPP_MESSAGING_TIERS = [
  "TIER_NOT_SET",
  "TIER_50",
  "TIER_250",
  "TIER_2K",
  "TIER_10K",
  "TIER_100K",
  "TIER_UNLIMITED",
] as const

export type WhatsappMessagingTier = (typeof WHATSAPP_MESSAGING_TIERS)[number]

export function isWhatsappMessagingTier(value: unknown): value is WhatsappMessagingTier {
  return (
    typeof value === "string" &&
    (WHATSAPP_MESSAGING_TIERS as readonly string[]).includes(value as WhatsappMessagingTier)
  )
}

export const WHATSAPP_MESSAGING_TIER_LABELS: Record<WhatsappMessagingTier, string> = {
  TIER_NOT_SET: "Ainda não definido",
  TIER_50: "50 contatos por dia",
  TIER_250: "250 contatos por dia",
  TIER_2K: "2.000 contatos por dia",
  TIER_10K: "10.000 contatos por dia",
  TIER_100K: "100.000 contatos por dia",
  TIER_UNLIMITED: "Sem limite",
}

// ---------------------------------------------------------------------------
// Categoria de cobrança (quem paga é o cliente; isto é só para a tela dele)
// ---------------------------------------------------------------------------

/**
 * `pricing.billable` será depreciado pela Meta: a cobrança se deriva de
 * `pricing.type` + `pricing.category`. Guardamos os dois crus.
 */
export const WHATSAPP_PRICING_TYPES = [
  "regular",
  "free_customer_service",
  "free_entry_point",
] as const

export type WhatsappPricingType = (typeof WHATSAPP_PRICING_TYPES)[number]

export const WHATSAPP_PRICING_CATEGORIES = [
  "authentication",
  "authentication-international",
  "marketing",
  "marketing_lite",
  "referral_conversion",
  "service",
  "utility",
] as const

export type WhatsappPricingCategory = (typeof WHATSAPP_PRICING_CATEGORIES)[number]

export function isWhatsappPricingCategory(value: unknown): value is WhatsappPricingCategory {
  return (
    typeof value === "string" &&
    (WHATSAPP_PRICING_CATEGORIES as readonly string[]).includes(value as WhatsappPricingCategory)
  )
}

/** Categorias que só podem sair com consentimento de divulgação registrado. */
export const WHATSAPP_MARKETING_CATEGORIES: readonly WhatsappPricingCategory[] = [
  "marketing",
  "marketing_lite",
]

// ---------------------------------------------------------------------------
// Por que o envio não saiu
// ---------------------------------------------------------------------------

/**
 * Motivos que `queue_whatsapp_message` devolve em `{ok:false, reason}`. São
 * strings estáveis do banco: a tradução vive aqui, e a tela nunca inventa um
 * "erro ao enviar" genérico quando o produto sabe exatamente o que aconteceu.
 */
export const WHATSAPP_BLOCK_REASONS = [
  "conversa_nao_encontrada",
  "numero_nao_encontrado",
  "conexao_desligada",
  "numero_desligado",
  "numero_suspenso_por_qualidade",
  "contato_na_lista_de_supressao",
  "sem_consentimento_de_divulgacao",
  "janela_de_24h_fechada",
] as const

export type WhatsappBlockReason = (typeof WHATSAPP_BLOCK_REASONS)[number]

export function isWhatsappBlockReason(value: unknown): value is WhatsappBlockReason {
  return (
    typeof value === "string" &&
    (WHATSAPP_BLOCK_REASONS as readonly string[]).includes(value as WhatsappBlockReason)
  )
}

export const WHATSAPP_BLOCK_REASON_MESSAGES: Record<WhatsappBlockReason, string> = {
  conversa_nao_encontrada: "Esta conversa não existe mais.",
  numero_nao_encontrado: "O número desta conversa não está mais conectado.",
  conexao_desligada:
    "A conexão do WhatsApp está desligada ou suspensa. Veja em Configurações › Conexões.",
  numero_desligado: "Este número está desligado em Configurações › Conexões.",
  numero_suspenso_por_qualidade:
    "O envio por este número está suspenso porque a qualidade dele caiu. Receber continua funcionando.",
  contato_na_lista_de_supressao:
    "Este contato pediu para não receber mensagens. Não é possível enviar.",
  sem_consentimento_de_divulgacao:
    "Não há autorização registrada deste contato para receber divulgação.",
  janela_de_24h_fechada:
    "Passaram-se mais de 24 horas desde a última mensagem do contato. Só é possível enviar por um modelo aprovado.",
}

/** Tradução do motivo; nunca devolve texto cru do banco para a tela. */
export function whatsappBlockReasonMessage(reason: unknown): string {
  return isWhatsappBlockReason(reason)
    ? WHATSAPP_BLOCK_REASON_MESSAGES[reason]
    : "Não foi possível enviar agora. Tente de novo."
}

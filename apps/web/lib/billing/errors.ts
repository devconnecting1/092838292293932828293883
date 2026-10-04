// Tradução dos erros de assinatura (banco) e da Stripe para pt-BR.
// Sem `server-only` e sem importar o SDK da Stripe: os tradutores dos módulos
// (clientes, imóveis, propostas, configurações, marketing) também rodam no
// navegador. Os erros da Stripe são reconhecidos pelo formato (`type`).

import { SUBSCRIPTION_SETTINGS_PATH } from "@/lib/auth/routes"

/** Página da assinatura, para o link "Ver assinatura" dos avisos. */
export const BILLING_SETTINGS_PATH = SUBSCRIPTION_SETTINGS_PATH

/** Códigos estáveis levantados pelos triggers de billing do banco. */
export const BILLING_ERROR_CODES = [
  "assinatura_somente_leitura",
  "limite_usuarios",
  "limite_landing_pages",
  "limite_owned_listings",
  "limite_photos_per_listing",
] as const

export type BillingErrorCode = (typeof BILLING_ERROR_CODES)[number]

/**
 * O que conta no limite de imóveis com foto. Foto trazida por link na
 * importação de planilhas é baixada para o nosso bucket e CONTA; só não conta o
 * imóvel cujas fotos continuam hospedadas no site de origem.
 */
const OWNED_LISTINGS_COUNT_RULE =
  "Imóveis vendidos, alugados, inativos ou só com fotos hospedadas no site de origem não contam; fotos trazidas por link na importação de planilhas contam."
/** Saída para quem precisa de mais vagas: pacote de +10 imóveis ou plano maior. */
const OWNED_LISTINGS_UPGRADE_HINT =
  "contrate pacotes de +10 imóveis ou mude de plano em Configurações > Assinatura"

const BILLING_ERROR_MESSAGES: Record<BillingErrorCode, string> = {
  assinatura_somente_leitura:
    "A imobiliária está no modo leitura (sem assinatura ativa ou com exclusão agendada): dá para ver e exportar tudo, mas não criar nem editar. O dono pode regularizar em Configurações > Assinatura ou cancelar a exclusão em Configurações > Imobiliária.",
  limite_usuarios:
    "O limite de usuários do plano foi atingido (membros ativos e convites pendentes contam). Desative um acesso, cancele um convite ou contrate mais usuários em Configurações > Assinatura.",
  limite_landing_pages:
    "O limite de landing pages publicadas do plano foi atingido. Despublique uma página ou mude de plano em Configurações > Assinatura.",
  // Vem ao enviar a primeira foto de um imóvel e também ao reativar um imóvel com
  // foto (troca de status ou reserva por proposta).
  limite_owned_listings: `O limite de imóveis com fotos hospedadas por nós foi atingido. ${OWNED_LISTINGS_COUNT_RULE} Para liberar a vaga, marque como vendido, alugado ou inativo um imóvel que saiu da carteira, ou ${OWNED_LISTINGS_UPGRADE_HINT}.`,
  limite_photos_per_listing:
    "Este imóvel já tem o número máximo de fotos do plano. Apague uma foto para enviar outra, ou mude de plano em Configurações > Assinatura.",
}

export const STRIPE_GENERIC_ERROR =
  "Não foi possível falar com o sistema de pagamentos agora. Tente novamente em instantes."

const STRIPE_ERROR_MESSAGES: Record<string, string> = {
  StripeCardError:
    "O pagamento foi recusado pelo emissor do cartão. Confira os dados ou use outra forma de pagamento.",
  StripeRateLimitError:
    "Muitas solicitações ao sistema de pagamentos agora. Aguarde alguns segundos e tente de novo.",
  StripeIdempotencyError:
    "Uma solicitação igual ainda está sendo processada. Aguarde um instante e tente de novo.",
  StripeAuthenticationError:
    "Os pagamentos não estão configurados corretamente nesta instalação. Avise o suporte.",
  StripePermissionError:
    "Os pagamentos não estão configurados corretamente nesta instalação. Avise o suporte.",
  StripeInvalidRequestError:
    "Não foi possível abrir o pagamento com esses dados. Tente de novo ou fale com o suporte.",
  StripeConnectionError: STRIPE_GENERIC_ERROR,
  StripeAPIError: STRIPE_GENERIC_ERROR,
}

type ErrorLike = {
  code?: unknown
  message?: unknown
  details?: unknown
  hint?: unknown
  type?: unknown
  name?: unknown
  reason?: unknown
  statusCode?: unknown
  requestId?: unknown
}

function asErrorLike(error: unknown): ErrorLike | null {
  return typeof error === "object" && error !== null ? (error as ErrorLike) : null
}

function text(value: unknown) {
  return typeof value === "string" ? value : ""
}

/** Código de billing presente na mensagem/detalhes do erro do banco, se houver. */
export function getBillingErrorCode(error: unknown): BillingErrorCode | null {
  const candidate = asErrorLike(error)

  if (!candidate) {
    return null
  }

  const context = `${text(candidate.message)} ${text(candidate.details)} ${text(candidate.hint)}`

  return BILLING_ERROR_CODES.find((code) => new RegExp(`\\b${code}\\b`).test(context)) ?? null
}

/** Tipo do erro do SDK da Stripe (ex.: "StripeCardError"); null se não for da Stripe. */
function getStripeErrorType(error: unknown): string | null {
  const type = asErrorLike(error)?.type
  return typeof type === "string" && /^Stripe[A-Za-z]*Error$/.test(type) ? type : null
}

/** Portal de cobrança sem configuração salva no painel da Stripe. */
export function isPortalNotConfiguredError(error: unknown): boolean {
  if (getStripeErrorType(error) !== "StripeInvalidRequestError") {
    return false
  }

  return /no configuration provided|default configuration has not been created/i.test(
    text(asErrorLike(error)?.message)
  )
}

/** `{limit, usage}` que os triggers de limite mandam em `detail` (texto JSON). */
function readLimitDetail(error: unknown): { limit: number; usage: number } | null {
  const details = text(asErrorLike(error)?.details)

  if (!details) {
    return null
  }

  try {
    const parsed: unknown = JSON.parse(details)

    if (typeof parsed !== "object" || parsed === null) {
      return null
    }

    const { limit, usage } = parsed as { limit?: unknown; usage?: unknown }

    return typeof limit === "number" && typeof usage === "number" ? { limit, usage } : null
  } catch {
    return null
  }
}

function plural(count: number, singular: string, pluralForm: string) {
  return `${count} ${count === 1 ? singular : pluralForm}`
}

function limitMessage(code: BillingErrorCode, error: unknown): string {
  const detail = readLimitDetail(error)

  if (!detail) {
    return BILLING_ERROR_MESSAGES[code]
  }

  if (code === "limite_usuarios") {
    return `Seu plano permite ${plural(detail.limit, "usuário", "usuários")} e há ${detail.usage} em uso (membros ativos e convites pendentes). Desative um acesso, cancele um convite ou contrate mais usuários em Configurações > Assinatura.`
  }

  if (code === "limite_landing_pages") {
    return `Seu plano permite ${plural(detail.limit, "landing page publicada", "landing pages publicadas")} e há ${detail.usage} no ar. Despublique uma página ou mude de plano em Configurações > Assinatura.`
  }

  if (code === "limite_owned_listings") {
    return `Seu plano permite ${plural(detail.limit, "imóvel", "imóveis")} com fotos hospedadas por nós na carteira e você já tem ${detail.usage}. ${OWNED_LISTINGS_COUNT_RULE} Para liberar a vaga, marque como vendido, alugado ou inativo um imóvel que saiu da carteira, ou ${OWNED_LISTINGS_UPGRADE_HINT}.`
  }

  if (code === "limite_photos_per_listing") {
    return `Seu plano permite ${plural(detail.limit, "foto", "fotos")} por imóvel e este já tem ${detail.usage}. Apague uma foto para enviar outra, ou mude de plano em Configurações > Assinatura.`
  }

  return BILLING_ERROR_MESSAGES[code]
}

/**
 * Mensagem pt-BR para erros de assinatura (limites e modo leitura) e da Stripe.
 * Devolve null quando o erro não é desses tipos: o tradutor do módulo segue
 * com as regras dele. Nunca repassa o texto técnico da Stripe.
 */
export function translateBillingError(error: unknown): string | null {
  const billingCode = getBillingErrorCode(error)

  if (billingCode) {
    return limitMessage(billingCode, error)
  }

  const stripeType = getStripeErrorType(error)

  if (stripeType) {
    return STRIPE_ERROR_MESSAGES[stripeType] ?? STRIPE_GENERIC_ERROR
  }

  return null
}

/**
 * Resumo seguro para log (sem mensagens livres, e-mails ou IDs de cliente):
 * tipo/código da Stripe com o request id, ou o código da RPC.
 */
export function describeBillingError(error: unknown): string {
  const candidate = asErrorLike(error)

  if (!candidate) {
    return "erro desconhecido"
  }

  const stripeType = getStripeErrorType(error)

  if (stripeType) {
    const code = text(candidate.code)
    const requestId = text(candidate.requestId)
    return [stripeType, code, requestId].filter(Boolean).join(" ")
  }

  const name = text(candidate.name) || "Error"
  const code = text(candidate.code)
  const reason = text(candidate.reason)

  return [name, code, reason].filter(Boolean).join(" ")
}

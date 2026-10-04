import { ASK_MANAGER_HINT } from "@/lib/auth/permission-messages"
import { translateBillingError } from "@/lib/billing/errors"

type DatabaseErrorLike = {
  code?: string
  message: string
  details?: string | null
}

export const PERMISSION_DENIED_MESSAGE = `Seu papel nesta imobiliária não permite esta ação. ${ASK_MANAGER_HINT}`

export const SESSION_EXPIRED_MESSAGE = "Sua sessão expirou. Entre novamente."

const DEFAULT_MESSAGE = "Não foi possível salvar agora. Tente novamente."

/**
 * Traduz erros do Supabase/PostgREST para pt-BR. As funções e triggers do
 * banco já levantam mensagens em português (ex.: "A imobiliária precisa
 * manter pelo menos um dono ativo."); os erros genéricos do Postgres não.
 * Nunca devolve detalhes técnicos ao usuário.
 */
export function translateDatabaseError(
  error: DatabaseErrorLike,
  fallback: string = DEFAULT_MESSAGE
) {
  const billingMessage = translateBillingError(error)

  if (billingMessage) {
    return billingMessage
  }

  const message = error.message ?? ""
  const isGenericPostgresMessage =
    /violates|constraint|relation|column|permission denied|syntax/i.test(message)

  switch (error.code) {
    case "42501":
      return PERMISSION_DENIED_MESSAGE
    case "23514":
      return isGenericPostgresMessage
        ? "Algum campo tem um valor inválido. Confira e tente de novo."
        : message
    case "23505":
      return "Já existe um registro com estes dados."
    case "23502":
      return "Preencha os campos obrigatórios."
    case "22001":
      return "Algum campo passou do tamanho permitido."
    case "22023":
    case "P0001":
    case "P0002":
      return isGenericPostgresMessage || !message ? fallback : message
    case "PGRST301":
    case "PGRST303":
      return SESSION_EXPIRED_MESSAGE
    default:
      return fallback
  }
}

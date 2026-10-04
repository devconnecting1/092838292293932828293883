import { ASK_MANAGER_HINT } from "@/lib/auth/permission-messages"
import { translateBillingError } from "@/lib/billing/errors"

/**
 * Traduz erros do Supabase/PostgREST para mensagens em pt-BR. Usado pelas
 * Server Actions de clientes, agenda e tarefas. Nunca devolve o texto cru do
 * banco (pode conter dados pessoais), exceto mensagens que as próprias
 * funções/triggers já escrevem em pt-BR.
 */
export type DatabaseErrorLike = {
  code?: string
  message: string
  details?: string | null
  hint?: string | null
}

export const GENERIC_ERROR_MESSAGE = "Não foi possível concluir agora. Tente novamente."

/** Mensagem padrão quando o RLS bloqueia (42501 ou UPDATE/DELETE sem linhas). */
export function permissionDeniedMessage(action: string) {
  return `Você não tem permissão para ${action}. ${ASK_MANAGER_HINT}`
}

const CHECK_CONSTRAINT_MESSAGES: Record<string, string> = {
  clients_document_format: "CPF/CNPJ em formato inválido.",
  clients_postal_code_format: "CEP inválido.",
  clients_state_format: "UF inválida.",
  client_interests_price_range: "O preço máximo precisa ser maior ou igual ao mínimo.",
  client_documents_storage_path_format: "O caminho do arquivo é inválido.",
  appointments_period: "O horário de término precisa ser depois do início.",
  appointments_rating_check: "A nota precisa ser de 1 a 5.",
}

function includesAny(context: string, needles: string[]) {
  return needles.some((needle) => context.includes(needle))
}

export function translateDatabaseError(error: DatabaseErrorLike, action: string) {
  const billingMessage = translateBillingError(error)

  if (billingMessage) {
    return billingMessage
  }

  const context = `${error.message} ${error.details ?? ""} ${error.hint ?? ""}`.toLowerCase()

  switch (error.code) {
    case "42501":
      return permissionDeniedMessage(action)
    case "23505":
      if (
        includesAny(context, ["clients_organization_document_key", "(organization_id, document)"])
      ) {
        return "Já existe um cliente com este CPF/CNPJ."
      }
      if (context.includes("client_shares_client_user_key")) {
        return "Este cliente já está compartilhado com essa pessoa."
      }
      if (context.includes("storage_path")) {
        return "Este arquivo já foi registrado."
      }
      return "Já existe um registro com esses dados."
    case "23514": {
      // Mensagem do trigger validate_member_columns (já em pt-BR).
      if (context.includes("membro ativo")) {
        return error.message
      }
      for (const [constraint, message] of Object.entries(CHECK_CONSTRAINT_MESSAGES)) {
        if (context.includes(constraint)) {
          return message
        }
      }
      return "Algum dado não passou na validação. Confira os campos."
    }
    case "23503":
      return "O registro relacionado não existe mais ou pertence a outra imobiliária."
    case "23502":
      return "Preencha os campos obrigatórios."
    case "22001":
      return "Algum texto passou do tamanho máximo permitido."
    case "22P02":
    case "22007":
    case "22008":
      return "Algum valor está em um formato inválido."
    // Validações das funções do banco (mensagens já em pt-BR).
    case "22023":
    case "P0001":
      return error.message
    case "P0002":
    case "PGRST116":
      return "Registro não encontrado. Ele pode ter sido removido."
    default:
      return GENERIC_ERROR_MESSAGE
  }
}

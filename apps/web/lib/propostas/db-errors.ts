// Tradução de erros do Supabase/PostgREST para mensagens em pt-BR.
// Usado pelos módulos de chaves, propostas e captações.

import { translateBillingError } from "@/lib/billing/errors"

export type DbErrorLike = {
  code?: string
  message: string
  details?: string | null
}

const GENERIC_ERROR = "Não foi possível concluir agora. Tente novamente."

/**
 * @param permissionMessage frase completa para 42501, ex.: "Você não tem permissão para editar esta chave."
 */
export function translateDbError(
  error: DbErrorLike,
  permissionMessage: string,
  fallback: string = GENERIC_ERROR
) {
  const billingMessage = translateBillingError(error)

  if (billingMessage) {
    return billingMessage
  }

  switch (error.code) {
    case "42501":
      return permissionMessage
    case "PGRST116":
      return "Registro não encontrado. Recarregue a página."
    case "23505":
      return "Já existe um registro com esses dados."
    case "23503":
      return "Um dos registros vinculados não existe mais. Recarregue a página."
    case "23514":
      // Os triggers de validação de membros já mandam a mensagem em pt-BR.
      return error.message.includes("membro ativo")
        ? error.message
        : "Algum valor informado é inválido. Confira os campos."
    case "22P02":
    case "22007":
    case "22008":
      return "Algum valor informado é inválido. Confira os campos."
    // Validações das funções do banco (mensagens já em pt-BR).
    case "22023":
    case "P0001":
      return error.message
    case "54000":
      return "Muitas solicitações em pouco tempo. Aguarde um instante e tente de novo."
    case "PGRST202":
    case "42883":
    case "42P01":
      return "O banco ainda não está atualizado para esta função. Aplique as migrações e tente de novo."
    default:
      return fallback
  }
}

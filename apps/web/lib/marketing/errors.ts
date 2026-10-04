import { translateBillingError } from "@/lib/billing/errors"

/**
 * Erros do Supabase/PostgREST e do Storage traduzidos para pt-BR no módulo de
 * landing pages. O RLS e os CHECKs do banco são a garantia final.
 */

export type DbErrorLike = {
  code?: string | null
  message?: string | null
  details?: string | null
}

export const LANDING_PERMISSION_MESSAGE =
  "Seu papel nesta imobiliária não permite editar landing pages. Peça ao dono, ao gerente ou a um assistente."

/** Fim das recusas do Storage: quem resolve é o mesmo trio. */
const LANDING_EDITORS_HINT = "Peça ao dono, ao gerente ou a um assistente da imobiliária."

export const LANDING_SLUG_TAKEN_MESSAGE =
  "Já existe uma landing page com este endereço nesta imobiliária. Escolha outro."

export const LANDING_TABLE_MISSING_MESSAGE =
  "As landing pages ainda não foram ativadas no banco desta instalação."

/** Tabela ou coluna inexistente (migração ainda não aplicada). */
export function isMissingRelationError(error: DbErrorLike | null | undefined) {
  if (!error) return false
  return (
    error.code === "42P01" ||
    error.code === "PGRST205" ||
    error.code === "42703" ||
    error.code === "PGRST204"
  )
}

function mentionsSlug(error: DbErrorLike) {
  return /slug/i.test(`${error.message ?? ""} ${error.details ?? ""}`)
}

/**
 * @param action complemento de "Não foi possível ...", ex.: "salvar a landing page".
 */
export function translateLandingError(error: DbErrorLike, action: string) {
  const billingMessage = translateBillingError(error)

  if (billingMessage) {
    return billingMessage
  }

  const message = error.message ?? ""

  if (isMissingRelationError(error)) {
    return LANDING_TABLE_MISSING_MESSAGE
  }

  switch (error.code) {
    case "42501":
      return LANDING_PERMISSION_MESSAGE
    case "23505":
      return mentionsSlug(error) || !message
        ? LANDING_SLUG_TAKEN_MESSAGE
        : "Este registro já existe."
    case "23514":
      if (mentionsSlug(error)) {
        return "Endereço inválido: use de 3 a 60 caracteres entre letras minúsculas, números e hífens."
      }
      return "Algum campo tem um valor que o banco não aceita. Confira os dados e tente de novo."
    case "23503":
      return "Um imóvel ou corretor selecionado não existe mais nesta imobiliária."
    case "23502":
      return "Preencha os campos obrigatórios."
    case "22P02":
      return "Algum valor está em formato inválido."
    case "22001":
      return "Algum texto passou do tamanho permitido."
    case "PGRST116":
      return "Landing page não encontrada. Ela pode ter sido removida ou você não tem acesso."
    case "PGRST301":
    case "PGRST303":
      return "Sua sessão expirou. Entre novamente."
    case "P0001":
    case "22023":
      return /violates|constraint|permission denied/i.test(message) || !message
        ? `Não foi possível ${action} agora. Tente novamente.`
        : message
    default:
      return `Não foi possível ${action} agora. Tente novamente.`
  }
}

/** Erro de upload/remoção no bucket landing-assets. */
export function translateLandingStorageError(
  error: { message?: string; statusCode?: string | number } | null,
  action: string
) {
  const text = `${error?.message ?? ""}`.toLowerCase()
  const status = String(error?.statusCode ?? "")

  if (status === "403" || text.includes("row-level security") || text.includes("unauthorized")) {
    return `Você não tem permissão para ${action}. ${LANDING_EDITORS_HINT}`
  }
  if (status === "413" || text.includes("maximum allowed size") || text.includes("too large")) {
    return "O arquivo passa de 5 MB."
  }
  if (status === "415" || text.includes("mime type") || text.includes("not supported")) {
    return "Formato não aceito. Envie JPG, PNG ou WebP."
  }
  if (status === "404" || text.includes("bucket not found")) {
    return "O armazenamento de imagens das landing pages ainda não foi ativado."
  }
  if (status === "409" || text.includes("already exists")) {
    return "Já existe um arquivo com este nome. Tente enviar de novo."
  }
  return `Não foi possível ${action} agora. Tente novamente.`
}

import { translateDatabaseError } from "@/lib/configuracoes/errors"

type DatabaseErrorLike = {
  code?: string
  message: string
  details?: string | null
}

export const TEAM_NAME_TAKEN_MESSAGE = "Já existe uma equipe com este nome."
export const TEAM_NOT_FOUND_MESSAGE =
  "Esta equipe não existe mais. Atualize a página para ver as equipes de agora."

/** Erros de teams/team_members em pt-BR, sem detalhe técnico. */
export function translateTeamError(
  error: DatabaseErrorLike,
  fallback = "Não foi possível salvar a equipe agora. Tente novamente."
) {
  const text = `${error.message ?? ""} ${error.details ?? ""}`

  if (error.code === "23505") {
    return text.includes("team_members")
      ? "Essa pessoa já está numa equipe. Atualize a página e tente de novo."
      : TEAM_NAME_TAKEN_MESSAGE
  }

  if (error.code === "23503") {
    return text.includes("teams")
      ? TEAM_NOT_FOUND_MESSAGE
      : "Essa pessoa não faz mais parte da imobiliária. Atualize a página."
  }

  if (error.code === "23514" && text.includes("teams_name_length")) {
    return "O nome da equipe precisa ter de 1 a 80 caracteres."
  }

  return translateDatabaseError(error, fallback)
}

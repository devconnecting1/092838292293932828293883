import { ROLE_LABELS, type Role } from "@/lib/auth/roles"

/**
 * Mensagens de "sem permissão" que dizem **quem** pode e **o que fazer**.
 *
 * Uma recusa só ajuda quem está trabalhando se ela nomear o papel que resolve:
 * "Você não tem permissão" faz a pessoa parar; "Somente o dono ou o gerente
 * podem remover fotos. Peça a quem tem esse papel." faz ela seguir.
 */

/** Como cada papel aparece no meio de uma frase. */
const ROLE_SUBJECTS: Record<Role, string> = {
  owner: "o dono",
  manager: "o gerente",
  broker: "um corretor",
  capturer: "um captador",
  assistant: "um assistente",
  finance: "o financeiro",
}

function joinWithOr(parts: readonly string[]) {
  if (parts.length <= 1) return parts[0] ?? ""
  return `${parts.slice(0, -1).join(", ")} ou ${parts[parts.length - 1]}`
}

/** "o dono ou o gerente", "o dono, o gerente ou um assistente". */
export function rolesSentence(roles: readonly Role[]) {
  return joinWithOr(roles.map((role) => ROLE_SUBJECTS[role]))
}

/** Rótulos dos papéis separados por vírgula: "Dono, Gerente". */
export function roleLabelsSentence(roles: readonly Role[]) {
  return joinWithOr(roles.map((role) => ROLE_LABELS[role]))
}

/**
 * @param action complemento de "podem ...", ex.: "remover fotos".
 * @param allowed papéis que conseguem fazer aquilo.
 */
export function permissionDeniedMessage(action: string, allowed: readonly Role[]) {
  if (allowed.length === 0) {
    return `Nenhum papel desta imobiliária pode ${action}.`
  }

  const verb = allowed.length === 1 ? "pode" : "podem"
  return `Somente ${rolesSentence(allowed)} ${verb} ${action}. Peça a quem tem esse papel na sua imobiliária.`
}

/** Recusa de um registro específico (o papel até permite, o vínculo é que falta). */
export function assignmentDeniedMessage(action: string) {
  return `Você não tem permissão para ${action}. Um dono ou gerente pode fazer isso, ou pedir para colocarem você como corretor ou captador do registro.`
}

/** Fim de qualquer mensagem genérica de 42501: diz a quem recorrer. */
export const ASK_MANAGER_HINT = "Peça ao dono ou ao gerente da imobiliária."

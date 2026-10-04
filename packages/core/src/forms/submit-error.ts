// Falha ao enviar um formulário (Server Action que rejeita): distingue queda de
// rede de erro inesperado, para a tela mostrar a mensagem certa sem perder os
// campos. Módulo puro: quem chama informa se o navegador está on-line.

export type SubmitFailureKind = "offline" | "unexpected"

export const OFFLINE_SUBMIT_MESSAGE =
  "Sem conexão. Seus dados continuam aqui; tente salvar de novo."

export const UNEXPECTED_SUBMIT_MESSAGE =
  "Não foi possível salvar agora. Seus dados continuam aqui; tente de novo em instantes."

/** Mensagens de fetch sem rede nos navegadores e no Node (Chrome, Firefox, Safari, undici). */
const NETWORK_ERROR_PATTERN =
  /failed to fetch|networkerror|network error|load failed|fetch failed|network request failed|network connection was lost|internet connection appears to be offline|err_internet_disconnected|err_network_changed/i

const MAX_CAUSE_DEPTH = 5

function readMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === "string") return error
  if (typeof error === "object" && error !== null && "message" in error) {
    const { message } = error as { message: unknown }
    return typeof message === "string" ? message : ""
  }
  return ""
}

function readCause(error: unknown): unknown {
  return typeof error === "object" && error !== null && "cause" in error
    ? (error as { cause: unknown }).cause
    : undefined
}

/** A falha veio da rede (sem internet, conexão caiu no meio do envio)? */
export function isNetworkError(error: unknown): boolean {
  let current: unknown = error

  for (let depth = 0; depth < MAX_CAUSE_DEPTH && current !== undefined; depth += 1) {
    if (NETWORK_ERROR_PATTERN.test(readMessage(current))) {
      return true
    }

    current = readCause(current)
  }

  return false
}

export function classifySubmitError(
  error: unknown,
  context: { online?: boolean } = {}
): SubmitFailureKind {
  if (context.online === false || isNetworkError(error)) {
    return "offline"
  }

  return "unexpected"
}

export function submitFailureMessage(kind: SubmitFailureKind): string {
  return kind === "offline" ? OFFLINE_SUBMIT_MESSAGE : UNEXPECTED_SUBMIT_MESSAGE
}

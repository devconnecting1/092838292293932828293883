type AuthErrorLike = {
  code?: string
  message: string
  status?: number
}

const AUTH_ERROR_MESSAGES: Record<string, string> = {
  invalid_credentials: "E-mail ou senha incorretos.",
  email_not_confirmed:
    "Confirme seu e-mail antes de entrar. Procure a mensagem que enviamos para sua caixa de entrada.",
  user_already_exists: "Já existe uma conta com este e-mail.",
  email_exists: "Já existe uma conta com este e-mail.",
  weak_password: "Senha fraca. Use pelo menos 8 caracteres, misturando letras, números e símbolos.",
  same_password: "A nova senha precisa ser diferente da atual.",
  over_email_send_rate_limit:
    "Muitos e-mails enviados em pouco tempo. Aguarde alguns minutos e tente de novo.",
  over_request_rate_limit: "Muitas tentativas seguidas. Aguarde alguns minutos e tente de novo.",
  otp_expired: "O link expirou. Peça um novo.",
  otp_disabled: "O acesso por link mágico está desativado.",
  signup_disabled: "Novos cadastros estão desativados no momento.",
  email_address_invalid: "E-mail inválido.",
  email_address_not_authorized:
    "Este e-mail não está autorizado a receber mensagens deste projeto.",
  session_not_found: "Sua sessão expirou. Entre novamente.",
  session_expired: "Sua sessão expirou. Entre novamente.",
  reauthentication_needed: "Por segurança, entre novamente antes de alterar a senha.",
  flow_state_not_found: "Link inválido. Abra o link no mesmo navegador em que você fez o pedido.",
  flow_state_expired: "O link expirou. Peça um novo.",
  bad_code_verifier: "Link inválido. Abra o link no mesmo navegador em que você fez o pedido.",
  user_banned: "Esta conta está bloqueada. Fale com o suporte.",
}

const DEFAULT_AUTH_ERROR = "Não foi possível concluir agora. Tente novamente."

export function translateAuthError(error: AuthErrorLike) {
  if (error.code && AUTH_ERROR_MESSAGES[error.code]) {
    return AUTH_ERROR_MESSAGES[error.code] ?? DEFAULT_AUTH_ERROR
  }

  if (error.status === 429) {
    return AUTH_ERROR_MESSAGES.over_request_rate_limit ?? DEFAULT_AUTH_ERROR
  }

  return DEFAULT_AUTH_ERROR
}

/**
 * Erros que revelariam se um e-mail tem conta. Nesses casos respondemos com
 * a mesma mensagem de sucesso, para não permitir enumeração de usuários.
 */
export function isAccountEnumerationError(error: AuthErrorLike) {
  return (
    error.code === "otp_disabled" ||
    error.code === "user_not_found" ||
    error.code === "signup_disabled"
  )
}

const QUERY_ERROR_MESSAGES: Record<string, string> = {
  "link-invalido":
    "Link inválido ou já utilizado. Abra o link no mesmo navegador em que fez o pedido ou peça um novo.",
  "link-expirado": "O link expirou. Peça um novo para continuar.",
  "link-outro-navegador":
    "Este link precisa ser aberto no mesmo navegador em que você fez o pedido. Peça um novo link por aqui.",
  "sessao-expirada": "Sua sessão expirou. Entre novamente.",
}

const QUERY_NOTICE_MESSAGES: Record<string, { title: string; message: string }> = {
  "email-confirmado": {
    title: "E-mail confirmado",
    message: "E-mail confirmado. Entre com sua senha para continuar.",
  },
}

/** Avisos positivos para `?aviso=` vindos dos route handlers de /auth. */
export function getAuthQueryNotice(code: string | null | undefined) {
  return code ? (QUERY_NOTICE_MESSAGES[code] ?? null) : null
}

/** Mensagens para `?erro=` vindas dos route handlers de /auth. */
export function getAuthQueryErrorMessage(code: string | null | undefined) {
  if (!code) {
    return null
  }

  return QUERY_ERROR_MESSAGES[code] ?? QUERY_ERROR_MESSAGES["link-invalido"] ?? null
}

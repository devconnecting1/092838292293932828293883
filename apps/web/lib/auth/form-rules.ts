// Validação dos formulários públicos de autenticação no navegador, sem zod: o zod
// somava ~38 KB (gzip) ao login no celular. O servidor revalida tudo com os schemas
// de lib/auth/schemas.ts, que usam as mesmas mensagens e limites daqui.

export const AUTH_MESSAGES = {
  emailRequired: "Informe seu e-mail.",
  emailInvalid: "E-mail inválido.",
  passwordRequired: "Informe sua senha.",
  newPasswordTooShort: "A senha precisa ter pelo menos 8 caracteres.",
  newPasswordTooLong: "A senha pode ter no máximo 72 caracteres.",
  fullNameTooShort: "Informe seu nome completo.",
  fullNameTooLong: "O nome pode ter no máximo 120 caracteres.",
  confirmPasswordRequired: "Repita a nova senha.",
  passwordsMismatch: "As senhas não conferem.",
} as const

export const NEW_PASSWORD_MIN_LENGTH = 8
export const NEW_PASSWORD_MAX_LENGTH = 72
export const FULL_NAME_MIN_LENGTH = 3
export const FULL_NAME_MAX_LENGTH = 120

const EMAIL_MAX_LENGTH = 254

/** Formato básico (nome@dominio.tld), sem regex com retrocesso. O servidor valida de novo. */
function isEmailAddress(value: string) {
  if (value.length > EMAIL_MAX_LENGTH || /\s/.test(value)) {
    return false
  }

  const at = value.indexOf("@")

  if (at <= 0 || at !== value.lastIndexOf("@")) {
    return false
  }

  const domain = value.slice(at + 1)
  const dot = domain.lastIndexOf(".")

  return dot > 0 && dot < domain.length - 1
}

export function validateEmail(value: string) {
  const email = value.trim()

  if (!email) {
    return AUTH_MESSAGES.emailRequired
  }

  return isEmailAddress(email) || AUTH_MESSAGES.emailInvalid
}

export function validateCurrentPassword(value: string) {
  return value.length > 0 || AUTH_MESSAGES.passwordRequired
}

export function validateNewPassword(value: string) {
  if (value.length < NEW_PASSWORD_MIN_LENGTH) {
    return AUTH_MESSAGES.newPasswordTooShort
  }

  return value.length <= NEW_PASSWORD_MAX_LENGTH || AUTH_MESSAGES.newPasswordTooLong
}

export function validateFullName(value: string) {
  const name = value.trim()

  if (name.length < FULL_NAME_MIN_LENGTH) {
    return AUTH_MESSAGES.fullNameTooShort
  }

  return name.length <= FULL_NAME_MAX_LENGTH || AUTH_MESSAGES.fullNameTooLong
}

export function validateConfirmPassword(value: string, values: { password: string }) {
  if (!value) {
    return AUTH_MESSAGES.confirmPasswordRequired
  }

  return value === values.password || AUTH_MESSAGES.passwordsMismatch
}

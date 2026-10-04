// Validação no servidor (Server Actions de autenticação). No navegador, os formulários
// usam lib/auth/form-rules.ts, sem zod; mensagens e limites vêm de lá.
import * as z from "zod/mini"

import {
  AUTH_MESSAGES,
  FULL_NAME_MAX_LENGTH,
  FULL_NAME_MIN_LENGTH,
  NEW_PASSWORD_MAX_LENGTH,
  NEW_PASSWORD_MIN_LENGTH,
} from "@/lib/auth/form-rules"

const emailSchema = z.pipe(
  z.string().check(z.trim(), z.minLength(1, AUTH_MESSAGES.emailRequired)),
  z.email(AUTH_MESSAGES.emailInvalid)
)

const newPasswordSchema = z
  .string()
  .check(
    z.minLength(NEW_PASSWORD_MIN_LENGTH, AUTH_MESSAGES.newPasswordTooShort),
    z.maxLength(NEW_PASSWORD_MAX_LENGTH, AUTH_MESSAGES.newPasswordTooLong)
  )

export const signInSchema = z.object({
  email: emailSchema,
  password: z.string().check(z.minLength(1, AUTH_MESSAGES.passwordRequired)),
})

export const magicLinkSchema = z.object({
  email: emailSchema,
})

export const signUpSchema = z.object({
  fullName: z
    .string()
    .check(
      z.trim(),
      z.minLength(FULL_NAME_MIN_LENGTH, AUTH_MESSAGES.fullNameTooShort),
      z.maxLength(FULL_NAME_MAX_LENGTH, AUTH_MESSAGES.fullNameTooLong)
    ),
  email: emailSchema,
  password: newPasswordSchema,
})

export const recoverPasswordSchema = z.object({
  email: emailSchema,
})

export const resetPasswordSchema = z
  .object({
    password: newPasswordSchema,
    confirmPassword: z.string().check(z.minLength(1, AUTH_MESSAGES.confirmPasswordRequired)),
  })
  .check(
    z.refine((values) => values.password === values.confirmPassword, {
      error: AUTH_MESSAGES.passwordsMismatch,
      path: ["confirmPassword"],
    })
  )

export type SignInValues = z.infer<typeof signInSchema>
export type MagicLinkValues = z.infer<typeof magicLinkSchema>
export type SignUpValues = z.infer<typeof signUpSchema>
export type RecoverPasswordValues = z.infer<typeof recoverPasswordSchema>
export type ResetPasswordValues = z.infer<typeof resetPasswordSchema>

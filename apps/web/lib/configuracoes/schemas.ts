import { z } from "zod"

import { isValidCnpj, isValidPhoneBr } from "@workspace/core/br/documents"
import { isStateCode } from "@workspace/core/br/states"
import { APP_ROLE_VALUES, type AppRole } from "@workspace/core/properties/enums"

import { HEX_COLOR_PATTERN, isHttpsUrl } from "@/lib/configuracoes/brand"
import { isDateOnly } from "@/lib/configuracoes/dates"

// Schemas compartilhados entre formulários (cliente) e Server Actions.
// Entrada e saída continuam string (o react-hook-form trabalha com os mesmos tipos).

function isEmail(value: string) {
  return z.email().safeParse(value).success
}

const optionalPhone = z
  .string()
  .trim()
  .refine(
    (value) => value === "" || isValidPhoneBr(value),
    "Telefone inválido. Informe o DDD e o número."
  )

const optionalState = z
  .string()
  .refine((value): boolean => value === "" || isStateCode(value), "Selecione uma UF válida.")

const roleSchema = z.custom<AppRole>(
  (value) => typeof value === "string" && (APP_ROLE_VALUES as readonly string[]).includes(value),
  { message: "Selecione um papel." }
)

// ---------------------------------------------------------------------------
// Imobiliária
// ---------------------------------------------------------------------------

export const organizationDataSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, "Informe o nome da imobiliária.")
    .max(160, "O nome pode ter no máximo 160 caracteres."),
  legalName: z
    .string()
    .trim()
    .min(2, "Informe a razão social.")
    .max(200, "A razão social pode ter no máximo 200 caracteres."),
  cnpj: z
    .string()
    .trim()
    .refine((value) => value === "" || isValidCnpj(value), "CNPJ inválido. Confira os caracteres."),
  creci: z
    .string()
    .trim()
    .min(2, "Informe o CRECI jurídico.")
    .max(30, "O CRECI pode ter no máximo 30 caracteres."),
  phone: optionalPhone,
  email: z
    .string()
    .trim()
    .max(254, "O e-mail pode ter no máximo 254 caracteres.")
    .refine((value) => value === "" || isEmail(value), "E-mail inválido."),
  city: z
    .string()
    .trim()
    .min(2, "Informe a cidade.")
    .max(120, "A cidade pode ter no máximo 120 caracteres."),
  state: z.string().refine((value): boolean => isStateCode(value), "Selecione a UF."),
})

export type OrganizationDataValues = z.infer<typeof organizationDataSchema>

export const brandSchema = z.object({
  primaryColor: z
    .string()
    .trim()
    .refine(
      (value) => value === "" || HEX_COLOR_PATTERN.test(value),
      "Use uma cor no formato #RRGGBB."
    ),
  logoUrl: z
    .string()
    .trim()
    .max(2048, "O endereço do logo é longo demais.")
    .refine(
      (value) => value === "" || isHttpsUrl(value),
      "Informe um endereço que comece com https://."
    ),
})

export type BrandValues = z.infer<typeof brandSchema>

// ---------------------------------------------------------------------------
// Equipe
// ---------------------------------------------------------------------------

export const invitationSchema = z.object({
  email: z
    .string()
    .trim()
    .min(1, "Informe o e-mail da pessoa.")
    .max(254, "O e-mail pode ter no máximo 254 caracteres.")
    .refine(isEmail, "E-mail inválido."),
  role: roleSchema,
})

export type InvitationValues = z.infer<typeof invitationSchema>

export const membershipIdSchema = z.guid("Membro inválido.")
export const invitationIdSchema = z.guid("Convite inválido.")
export { roleSchema }

// ---------------------------------------------------------------------------
// Perfil
// ---------------------------------------------------------------------------

export const profileSchema = z
  .object({
    fullName: z
      .string()
      .trim()
      .min(3, "Informe seu nome completo.")
      .max(160, "O nome pode ter no máximo 160 caracteres."),
    phone: optionalPhone,
    avatarUrl: z
      .string()
      .trim()
      .max(2048, "O endereço da foto é longo demais.")
      .refine(
        (value) => value === "" || isHttpsUrl(value),
        "Informe um endereço que comece com https://."
      ),
    creciNumber: z.string().trim().max(30, "O CRECI pode ter no máximo 30 caracteres."),
    creciState: optionalState,
    creciValidUntil: z
      .string()
      .refine((value) => value === "" || isDateOnly(value), "Data inválida."),
  })
  .refine((values) => values.creciNumber === "" || values.creciState !== "", {
    message: "Informe a UF do CRECI.",
    path: ["creciState"],
  })

export type ProfileValues = z.infer<typeof profileSchema>

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, "Informe sua senha atual."),
    password: z
      .string()
      .min(8, "A senha precisa ter pelo menos 8 caracteres.")
      .max(72, "A senha pode ter no máximo 72 caracteres."),
    confirmPassword: z.string().min(1, "Repita a nova senha."),
  })
  .refine((values) => values.password === values.confirmPassword, {
    message: "As senhas não conferem.",
    path: ["confirmPassword"],
  })
  .refine((values) => values.password !== values.currentPassword, {
    message: "A nova senha precisa ser diferente da atual.",
    path: ["password"],
  })

export type ChangePasswordValues = z.infer<typeof changePasswordSchema>

/** Primeiro erro de cada campo, no formato que os formulários aplicam com setError. */
export function getFieldErrors<T extends string>(error: z.ZodError) {
  const fieldErrors: Partial<Record<T, string>> = {}
  const flattened = z.flattenError(error)

  for (const [field, messages] of Object.entries(flattened.fieldErrors)) {
    const message = (messages as string[] | undefined)?.[0]
    if (message) fieldErrors[field as T] = message
  }

  return fieldErrors
}

import { z } from "zod"

import { getTenantSlugIssue } from "@workspace/core/tenant/slug"

export const BRAZILIAN_STATES = [
  { code: "AC", name: "Acre" },
  { code: "AL", name: "Alagoas" },
  { code: "AP", name: "Amapá" },
  { code: "AM", name: "Amazonas" },
  { code: "BA", name: "Bahia" },
  { code: "CE", name: "Ceará" },
  { code: "DF", name: "Distrito Federal" },
  { code: "ES", name: "Espírito Santo" },
  { code: "GO", name: "Goiás" },
  { code: "MA", name: "Maranhão" },
  { code: "MT", name: "Mato Grosso" },
  { code: "MS", name: "Mato Grosso do Sul" },
  { code: "MG", name: "Minas Gerais" },
  { code: "PA", name: "Pará" },
  { code: "PB", name: "Paraíba" },
  { code: "PR", name: "Paraná" },
  { code: "PE", name: "Pernambuco" },
  { code: "PI", name: "Piauí" },
  { code: "RJ", name: "Rio de Janeiro" },
  { code: "RN", name: "Rio Grande do Norte" },
  { code: "RS", name: "Rio Grande do Sul" },
  { code: "RO", name: "Rondônia" },
  { code: "RR", name: "Roraima" },
  { code: "SC", name: "Santa Catarina" },
  { code: "SP", name: "São Paulo" },
  { code: "SE", name: "Sergipe" },
  { code: "TO", name: "Tocantins" },
] as const

export type BrazilianStateCode = (typeof BRAZILIAN_STATES)[number]["code"]

export function isBrazilianState(value: unknown): value is BrazilianStateCode {
  return typeof value === "string" && BRAZILIAN_STATES.some((state) => state.code === value)
}

/** Tamanho máximo do link (slug) no cadastro (o subdomínio aceita até 60). */
export const SLUG_MAX_LENGTH = 48

const SLUG_HYPHENS_MESSAGE =
  "Use apenas letras minúsculas, números e hífens simples, sem hífen no início ou no fim."

export function slugify(value: string) {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " e ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, SLUG_MAX_LENGTH)
    .replace(/-+$/g, "")
}

/**
 * Mantém só letras e números, em maiúsculas. Aceita o CNPJ alfanumérico
 * (vigente desde julho de 2026) além do numérico tradicional.
 */
export function normalizeCnpj(value: string) {
  return value
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, "")
    .slice(0, 14)
}

export function formatCnpj(value: string) {
  const cnpj = normalizeCnpj(value)
  let formatted = cnpj.slice(0, 2)

  if (cnpj.length > 2) formatted += `.${cnpj.slice(2, 5)}`
  if (cnpj.length > 5) formatted += `.${cnpj.slice(5, 8)}`
  if (cnpj.length > 8) formatted += `/${cnpj.slice(8, 12)}`
  if (cnpj.length > 12) formatted += `-${cnpj.slice(12, 14)}`

  return formatted
}

function cnpjCheckDigit(base: string) {
  const weights =
    base.length === 12
      ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
      : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]

  const sum = weights.reduce(
    (total, weight, index) => total + (base.charCodeAt(index) - 48) * weight,
    0
  )
  const rest = sum % 11

  return rest < 2 ? 0 : 11 - rest
}

export function isValidCnpj(value: string) {
  const cnpj = normalizeCnpj(value)

  if (!/^[0-9A-Z]{12}[0-9]{2}$/.test(cnpj) || /^(.)\1{13}$/.test(cnpj)) {
    return false
  }

  const first = cnpjCheckDigit(cnpj.slice(0, 12))
  const second = cnpjCheckDigit(cnpj.slice(0, 12) + first)

  return cnpj.slice(12) === `${first}${second}`
}

const LOWERCASE_WORDS = new Set(["da", "das", "de", "do", "dos", "e"])

export function toTitleCase(value: string) {
  return value
    .toLocaleLowerCase("pt-BR")
    .split(/\s+/)
    .filter(Boolean)
    .map((word, index) =>
      index > 0 && LOWERCASE_WORDS.has(word)
        ? word
        : word.charAt(0).toLocaleUpperCase("pt-BR") + word.slice(1)
    )
    .join(" ")
}

/**
 * "company" (pessoa jurídica, imobiliária) exige CNPJ/razão social/CRECI
 * jurídico; "person" (corretor autônomo, pessoa física) exige o CRECI da
 * pessoa física (número + UF), sem CNPJ nem razão social.
 */
export const ORGANIZATION_KIND_VALUES = ["company", "person"] as const
export type OrganizationKind = (typeof ORGANIZATION_KIND_VALUES)[number]

export function isOrganizationKind(value: unknown): value is OrganizationKind {
  return (
    typeof value === "string" && (ORGANIZATION_KIND_VALUES as readonly string[]).includes(value)
  )
}

export const organizationSchema = z
  .object({
    kind: z.enum(ORGANIZATION_KIND_VALUES),
    name: z
      .string()
      .trim()
      .min(2, "Informe o nome.")
      .max(120, "O nome pode ter no máximo 120 caracteres."),
    slug: z
      .string()
      .trim()
      .min(3, "O link precisa ter pelo menos 3 caracteres.")
      .max(SLUG_MAX_LENGTH, `O link pode ter no máximo ${SLUG_MAX_LENGTH} caracteres.`)
      // Mesma regra do subdomínio (@workspace/core/tenant/slug): sem hífen nas
      // pontas, sem "--" (inclui o prefixo IDN "xn--") e fora da lista reservada.
      .refine((slug) => getTenantSlugIssue(slug) !== "characters", SLUG_HYPHENS_MESSAGE)
      .refine((slug) => getTenantSlugIssue(slug) !== "hyphens", SLUG_HYPHENS_MESSAGE)
      .refine(
        (slug) => getTenantSlugIssue(slug) !== "reserved",
        "Este link é reservado. Escolha outro."
      ),
    // Só obrigatórios quando kind === "company" (ver superRefine abaixo).
    legalName: z.string().trim().max(200, "A razão social pode ter no máximo 200 caracteres."),
    cnpj: z
      .string()
      .trim()
      .refine((cnpj) => cnpj === "" || isValidCnpj(cnpj), "CNPJ inválido. Confira os números."),
    creci: z.string().trim().max(30, "O CRECI pode ter no máximo 30 caracteres."),
    // Só obrigatórios quando kind === "person" (ver superRefine abaixo).
    creciNumber: z.string().trim().max(30, "O CRECI pode ter no máximo 30 caracteres."),
    // Retorno `boolean` explícito: mesmo motivo do campo `state` abaixo (evita
    // que o TS infira um type predicate e mantém entrada e saída como string).
    creciState: z
      .string()
      .refine(
        (state): boolean => state === "" || isBrazilianState(state),
        "Selecione a UF do CRECI."
      ),
    city: z
      .string()
      .trim()
      .min(2, "Informe a cidade.")
      .max(120, "A cidade pode ter no máximo 120 caracteres."),
    // Retorno `boolean` explícito: evita que o TS infira um type predicate e
    // mantém entrada e saída como string no react-hook-form.
    state: z.string().refine((state): boolean => isBrazilianState(state), "Selecione a UF."),
  })
  .superRefine((values, ctx) => {
    if (values.kind === "company") {
      if (values.legalName.length < 2) {
        ctx.addIssue({ code: "custom", path: ["legalName"], message: "Informe a razão social." })
      }
      if (values.creci.length < 2) {
        ctx.addIssue({ code: "custom", path: ["creci"], message: "Informe o CRECI jurídico." })
      }
      return
    }

    if (values.creciNumber.length < 1) {
      ctx.addIssue({
        code: "custom",
        path: ["creciNumber"],
        message: "Informe o número do CRECI.",
      })
    }

    if (values.creciState === "") {
      ctx.addIssue({ code: "custom", path: ["creciState"], message: "Selecione a UF do CRECI." })
    }
  })

export type OrganizationValues = z.infer<typeof organizationSchema>

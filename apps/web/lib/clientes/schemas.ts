import { z } from "zod"

import {
  isValidCnpj,
  isValidCpf,
  isValidPhoneBr,
  isValidPostalCode,
  normalizeCnpj,
  normalizeCpf,
  normalizePhoneBr,
  normalizePostalCode,
} from "@workspace/core/br/documents"
import { isStateCode } from "@workspace/core/br/states"
import type { Tables, TablesUpdate } from "@workspace/database/types"

import { isDateKey, toDateKey, zonedToIso } from "@/lib/agenda/datetime"
import {
  CLIENT_TAG_MAX_LENGTH,
  CLIENT_TAGS_MAX,
  isClientSource,
  isLgpdLegalBasis,
} from "@/lib/clientes/constants"
import {
  maskCnpjInput,
  maskCpfInput,
  maskPhoneInput,
  maskPostalCodeInput,
} from "@/lib/clientes/format"

function text(max: number, label: string) {
  return z.string().trim().max(max, `${label} pode ter no máximo ${max} caracteres.`)
}

/**
 * Formulário de cliente (PF/PJ). Entrada e saída são strings (sem transform),
 * para o react-hook-form e a Server Action usarem o mesmo schema; a
 * normalização para o banco fica em `toClientRow`.
 */
export const clientFormSchema = z
  .object({
    kind: z.enum(["pf", "pj"]),
    name: text(200, "O nome"),
    tradeName: text(200, "O nome fantasia"),
    document: z.string().trim().max(20, "Documento inválido."),
    rg: text(30, "O RG"),
    birthDate: z.string(),
    email: text(254, "O e-mail"),
    phone: z.string().trim().max(20, "Telefone inválido."),
    whatsapp: z.string().trim().max(20, "WhatsApp inválido."),
    postalCode: z.string().trim().max(9, "CEP inválido."),
    street: text(200, "A rua"),
    streetNumber: text(20, "O número"),
    complement: text(120, "O complemento"),
    neighborhood: text(120, "O bairro"),
    city: text(120, "A cidade"),
    state: z.string(),
    source: z.string(),
    tags: z
      .array(
        z
          .string()
          .trim()
          .min(1, "Etiqueta vazia.")
          .max(
            CLIENT_TAG_MAX_LENGTH,
            `Cada etiqueta pode ter no máximo ${CLIENT_TAG_MAX_LENGTH} caracteres.`
          )
      )
      .max(CLIENT_TAGS_MAX, `Use no máximo ${CLIENT_TAGS_MAX} etiquetas.`),
    assignedTo: z.string(),
    legalBasis: z.string(),
    consentDate: z.string(),
    notes: text(10000, "As observações"),
  })
  .superRefine((values, ctx) => {
    const isPf = values.kind === "pf"
    const today = toDateKey(new Date())

    if (values.name.length < 2) {
      ctx.addIssue({
        code: "custom",
        path: ["name"],
        message: isPf ? "Informe o nome completo." : "Informe a razão social.",
      })
    }

    if (values.document) {
      const valid = isPf ? isValidCpf(values.document) : isValidCnpj(values.document)

      if (!valid) {
        ctx.addIssue({
          code: "custom",
          path: ["document"],
          message: isPf
            ? "CPF inválido. Confira os números."
            : "CNPJ inválido. Confira os caracteres.",
        })
      }
    }

    if (isPf && values.birthDate) {
      if (!isDateKey(values.birthDate)) {
        ctx.addIssue({
          code: "custom",
          path: ["birthDate"],
          message: "Data inválida.",
        })
      } else if (values.birthDate > today) {
        ctx.addIssue({
          code: "custom",
          path: ["birthDate"],
          message: "A data de nascimento não pode ser no futuro.",
        })
      }
    }

    if (values.email && !z.email().safeParse(values.email).success) {
      ctx.addIssue({
        code: "custom",
        path: ["email"],
        message: "E-mail inválido.",
      })
    }

    for (const field of ["phone", "whatsapp"] as const) {
      if (values[field] && !isValidPhoneBr(values[field])) {
        ctx.addIssue({
          code: "custom",
          path: [field],
          message: "Número inválido. Informe o DDD e o número.",
        })
      }
    }

    if (values.postalCode && !isValidPostalCode(values.postalCode)) {
      ctx.addIssue({
        code: "custom",
        path: ["postalCode"],
        message: "CEP inválido.",
      })
    }

    if (values.state && !isStateCode(values.state)) {
      ctx.addIssue({
        code: "custom",
        path: ["state"],
        message: "Selecione uma UF válida.",
      })
    }

    if (values.source && !isClientSource(values.source)) {
      ctx.addIssue({
        code: "custom",
        path: ["source"],
        message: "Origem inválida.",
      })
    }

    if (values.assignedTo && !z.guid().safeParse(values.assignedTo).success) {
      ctx.addIssue({
        code: "custom",
        path: ["assignedTo"],
        message: "Responsável inválido.",
      })
    }

    if (!isLgpdLegalBasis(values.legalBasis)) {
      ctx.addIssue({
        code: "custom",
        path: ["legalBasis"],
        message: "Selecione a base legal para tratar os dados deste cliente (LGPD).",
      })
    }

    if (values.legalBasis === "consent") {
      if (!values.consentDate || !isDateKey(values.consentDate)) {
        ctx.addIssue({
          code: "custom",
          path: ["consentDate"],
          message: "Informe a data em que o cliente deu o consentimento.",
        })
      } else if (values.consentDate > today) {
        ctx.addIssue({
          code: "custom",
          path: ["consentDate"],
          message: "A data do consentimento não pode ser no futuro.",
        })
      }
    }
  })

export type ClientFormValues = z.infer<typeof clientFormSchema>

export const EMPTY_CLIENT_FORM_VALUES: ClientFormValues = {
  kind: "pf",
  name: "",
  tradeName: "",
  document: "",
  rg: "",
  birthDate: "",
  email: "",
  phone: "",
  whatsapp: "",
  postalCode: "",
  street: "",
  streetNumber: "",
  complement: "",
  neighborhood: "",
  city: "",
  state: "",
  source: "",
  tags: [],
  assignedTo: "",
  legalBasis: "",
  consentDate: "",
  notes: "",
}

/** Linha do banco para os valores do formulário de edição. */
export function clientRowToFormValues(client: Tables<"clients">): ClientFormValues {
  const isPf = client.kind === "pf"

  return {
    kind: client.kind,
    name: client.name,
    tradeName: client.trade_name ?? "",
    document: client.document
      ? isPf
        ? maskCpfInput(client.document)
        : maskCnpjInput(client.document)
      : "",
    rg: client.rg ?? "",
    birthDate: client.birth_date ?? "",
    email: client.email ?? "",
    phone: client.phone ? maskPhoneInput(client.phone) : "",
    whatsapp: client.whatsapp ? maskPhoneInput(client.whatsapp) : "",
    postalCode: client.postal_code ? maskPostalCodeInput(client.postal_code) : "",
    street: client.street ?? "",
    streetNumber: client.street_number ?? "",
    complement: client.complement ?? "",
    neighborhood: client.neighborhood ?? "",
    city: client.city ?? "",
    state: client.state ?? "",
    source: client.source ?? "",
    tags: client.tags,
    assignedTo: client.assigned_to ?? "",
    legalBasis: client.lgpd_legal_basis ?? "",
    consentDate: client.lgpd_consent_at ? toDateKey(client.lgpd_consent_at) : "",
    notes: client.notes ?? "",
  }
}

function nullIfEmpty(value: string) {
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function uniqueTags(tags: string[]) {
  const seen = new Set<string>()
  const result: string[] = []

  for (const tag of tags) {
    const trimmed = tag.trim()
    const key = trimmed.toLocaleLowerCase("pt-BR")

    if (trimmed && !seen.has(key)) {
      seen.add(key)
      result.push(trimmed)
    }
  }

  return result
}

/**
 * Valores já validados para as colunas de `clients`. `previousConsentAt`
 * preserva o instante original quando a data do consentimento não mudou.
 */
export function toClientRow(
  values: ClientFormValues,
  options: { previousConsentAt?: string | null; now?: Date } = {}
) {
  const isPf = values.kind === "pf"
  const now = options.now ?? new Date()
  let consentAt: string | null = null

  if (values.legalBasis === "consent" && values.consentDate) {
    if (options.previousConsentAt && toDateKey(options.previousConsentAt) === values.consentDate) {
      consentAt = options.previousConsentAt
    } else if (values.consentDate === toDateKey(now)) {
      consentAt = now.toISOString()
    } else {
      consentAt = zonedToIso(values.consentDate, "12:00")
    }
  }

  return {
    kind: values.kind,
    name: values.name.trim(),
    trade_name: isPf ? null : nullIfEmpty(values.tradeName),
    document: values.document
      ? isPf
        ? normalizeCpf(values.document)
        : normalizeCnpj(values.document)
      : null,
    rg: isPf ? nullIfEmpty(values.rg) : null,
    birth_date: isPf && values.birthDate ? values.birthDate : null,
    email: values.email ? values.email.trim().toLowerCase() : null,
    phone: values.phone ? normalizePhoneBr(values.phone) : null,
    whatsapp: values.whatsapp ? normalizePhoneBr(values.whatsapp) : null,
    postal_code: values.postalCode ? normalizePostalCode(values.postalCode) : null,
    street: nullIfEmpty(values.street),
    street_number: nullIfEmpty(values.streetNumber),
    complement: nullIfEmpty(values.complement),
    neighborhood: nullIfEmpty(values.neighborhood),
    city: nullIfEmpty(values.city),
    state: values.state || null,
    source: values.source || null,
    tags: uniqueTags(values.tags),
    assigned_to: values.assignedTo || null,
    lgpd_legal_basis: values.legalBasis,
    lgpd_consent_at: consentAt,
    notes: nullIfEmpty(values.notes),
  } satisfies TablesUpdate<"clients">
}

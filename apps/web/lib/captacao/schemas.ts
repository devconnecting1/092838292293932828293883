import { z } from "zod"

import {
  isValidPhoneBr,
  isValidPostalCode,
  normalizePhoneBr,
  normalizePostalCode,
} from "@workspace/core/br/documents"
import { isStateCode } from "@workspace/core/br/states"
import { PROPERTY_TYPE_VALUES } from "@workspace/core/properties/enums"

import { parseBrlInput } from "@/lib/propostas/money"

export const CAPTURE_PURPOSES = ["sale", "rent", "sale_rent"] as const

const MAX_PRICE = 999_999_999_999.99

function isEmail(value: string) {
  return z.email().safeParse(value).success
}

/** Formulário público /captar/[slug] (mesmas regras da RPC submit_capture_request). */
export const publicCaptureSchema = z
  .object({
    ownerName: z
      .string()
      .trim()
      .min(2, "Informe seu nome.")
      .max(120, "O nome pode ter no máximo 120 caracteres."),
    ownerEmail: z
      .string()
      .trim()
      .max(254, "E-mail longo demais.")
      .refine((value) => value === "" || isEmail(value), "E-mail inválido."),
    ownerPhone: z
      .string()
      .trim()
      .refine(
        (value) => value === "" || isValidPhoneBr(value),
        "Telefone inválido. Informe o DDD e o número."
      ),
    purpose: z.enum(CAPTURE_PURPOSES, "Selecione a finalidade."),
    type: z
      .string()
      .refine(
        (value) => value === "" || (PROPERTY_TYPE_VALUES as readonly string[]).includes(value),
        "Tipo de imóvel inválido."
      ),
    postalCode: z
      .string()
      .trim()
      .refine((value) => value === "" || isValidPostalCode(value), "CEP inválido."),
    neighborhood: z.string().trim().max(120, "O bairro pode ter no máximo 120 caracteres."),
    city: z.string().trim().max(120, "A cidade pode ter no máximo 120 caracteres."),
    // Retorno `boolean` explícito: sem ele o type predicate estreita a saída e
    // o tipo deixa de bater com o react-hook-form.
    state: z
      .string()
      .refine((value): boolean => value === "" || isStateCode(value), "UF inválida."),
    expectedPrice: z
      .string()
      .refine(
        (value) => value === "" || (parseBrlInput(value) ?? 0) <= MAX_PRICE,
        "Valor alto demais."
      ),
    message: z.string().trim().max(2000, "A mensagem pode ter no máximo 2.000 caracteres."),
    consent: z.boolean().refine((value) => value, "Autorize o contato para enviar o formulário."),
  })
  .superRefine((values, ctx) => {
    if (!values.ownerEmail && !values.ownerPhone) {
      ctx.addIssue({
        code: "custom",
        path: ["ownerPhone"],
        message: "Informe um telefone ou e-mail para contato.",
      })
    }
  })

export type PublicCaptureValues = z.infer<typeof publicCaptureSchema>

/** Monta o payload no formato esperado por submit_capture_request. */
export function toCapturePayload(values: PublicCaptureValues) {
  const price = values.expectedPrice ? parseBrlInput(values.expectedPrice) : null

  return {
    owner_name: values.ownerName,
    owner_email: values.ownerEmail || null,
    owner_phone: values.ownerPhone ? normalizePhoneBr(values.ownerPhone) : null,
    purpose: values.purpose,
    type: values.type || null,
    postal_code: values.postalCode ? normalizePostalCode(values.postalCode) : null,
    neighborhood: values.neighborhood || null,
    city: values.city || null,
    state: values.state || null,
    expected_price: price !== null && price > 0 ? price.toFixed(2) : null,
    message: values.message || null,
    consent: values.consent,
  }
}

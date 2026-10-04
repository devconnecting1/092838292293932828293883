import { z } from "zod"

import { isValidPhoneBr, normalizePhoneBr } from "@workspace/core/br/documents"

import {
  LEAD_INTERESTS,
  LEAD_MESSAGE_MAX_LENGTH,
  LEAD_NAME_MAX_LENGTH,
  LEAD_TYPOLOGY_MAX_LENGTH,
  type LandingLeadOrigin,
  type LeadClickIds,
  type LeadUtm,
} from "@/lib/leads-publicos/constants"
import type { LandingLeadPayload } from "@/lib/leads-publicos/rpc-types"

function isEmail(value: string) {
  return z.email().safeParse(value).success
}

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && z.guid().safeParse(value).success
}

/** Formulário de lead das landing pages (mesmas regras de submit_landing_lead). */
export const landingLeadSchema = z
  .object({
    // Etapa 1 (contato)
    name: z
      .string()
      .trim()
      .min(2, "Informe seu nome.")
      .max(LEAD_NAME_MAX_LENGTH, "O nome pode ter no máximo 120 caracteres."),
    phone: z
      .string()
      .trim()
      .refine(
        (value) => value === "" || isValidPhoneBr(value),
        "Telefone inválido. Informe o DDD e o número."
      ),
    // Etapa 2 (detalhes, opcional)
    email: z
      .string()
      .trim()
      .max(254, "E-mail longo demais.")
      .refine((value) => value === "" || isEmail(value), "E-mail inválido."),
    interest: z.union([z.enum(LEAD_INTERESTS), z.literal("")], "Selecione uma opção válida."),
    // Retorno `boolean` explícito para o tipo de saída continuar `string`.
    propertyId: z
      .string()
      .refine((value): boolean => value === "" || isUuid(value), "Imóvel inválido."),
    typology: z.string().trim().max(LEAD_TYPOLOGY_MAX_LENGTH, "Tipologia inválida."),
    message: z
      .string()
      .trim()
      .max(LEAD_MESSAGE_MAX_LENGTH, "A mensagem pode ter no máximo 2.000 caracteres."),
    // Sempre visível, nas duas etapas.
    consent: z.boolean().refine((value) => value, "Autorize o contato para enviar."),
  })
  .superRefine((values, ctx) => {
    if (!values.phone && !values.email) {
      ctx.addIssue({
        code: "custom",
        path: ["phone"],
        message: "Informe seu telefone ou WhatsApp.",
      })
    }
  })

export type LandingLeadValues = z.infer<typeof landingLeadSchema>

/** Campos mostrados na etapa 1; os demais (exceto o consentimento) ficam na etapa 2. */
export const LEAD_CONTACT_STEP_FIELDS: readonly (keyof LandingLeadValues)[] = ["name", "phone"]

export type LandingLeadContext = {
  utm: LeadUtm
  /** Origem do link (?origem=), já validada. */
  origin?: LandingLeadOrigin | null
  clickIds: LeadClickIds
  referrer: string | null
  landingUrl: string | null
  eventId: string
}

/** Monta p_payload de submit_landing_lead a partir dos valores já validados. */
export function toLandingLeadPayload(
  values: LandingLeadValues,
  context: LandingLeadContext
): LandingLeadPayload {
  const payload: LandingLeadPayload = {
    name: values.name,
    utm: context.utm,
    click_ids: context.clickIds,
    event_id: context.eventId,
    consent: true,
  }

  if (values.email) payload.email = values.email.toLowerCase()
  if (values.phone) payload.phone = normalizePhoneBr(values.phone)
  if (values.message) payload.message = values.message
  if (values.propertyId) payload.property_id = values.propertyId
  if (values.interest) payload.interest = values.interest
  if (values.typology) payload.typology = values.typology
  if (context.origin) payload.origin = context.origin
  if (context.landingUrl) payload.landing_url = context.landingUrl
  if (context.referrer) payload.referrer = context.referrer

  return payload
}

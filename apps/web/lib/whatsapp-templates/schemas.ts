import { z } from "zod"

import {
  WHATSAPP_TEMPLATE_BODY_MAX_LENGTH,
  WHATSAPP_TEMPLATE_TITLE_MAX_LENGTH,
} from "@workspace/core/leads/whatsapp-message"

/** Mesmas regras da tabela: título de 2 a 60 e texto de 2 a 1.000 caracteres. */
export const whatsappTemplateSchema = z.object({
  title: z
    .string()
    .trim()
    .min(2, "Dê um título ao modelo (pelo menos 2 caracteres).")
    .max(
      WHATSAPP_TEMPLATE_TITLE_MAX_LENGTH,
      `O título tem no máximo ${WHATSAPP_TEMPLATE_TITLE_MAX_LENGTH} caracteres.`
    ),
  body: z
    .string()
    .trim()
    .min(2, "Escreva o texto da mensagem.")
    .max(WHATSAPP_TEMPLATE_BODY_MAX_LENGTH, "O texto tem no máximo 1.000 caracteres."),
})

export type WhatsappTemplateValues = z.infer<typeof whatsappTemplateSchema>

export const whatsappTemplateIdSchema = z.uuid("Modelo inválido.")

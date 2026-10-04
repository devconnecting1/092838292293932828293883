import { z } from "zod"

import {
  normalizeGoogleTagId,
  normalizeMetaPixelId,
} from "@workspace/core/properties/listing-publication"

/** Formulário "Anúncios e página pública" (Configurações → Imobiliária). */
export const listingPublicationSettingsSchema = z.object({
  hideWithoutValidAuthorization: z.boolean(),
  publicPagesEnabledByDefault: z.boolean(),
  metaPixelId: z
    .string()
    .trim()
    .max(20, "O ID do Meta Pixel tem só números (de 5 a 20 dígitos).")
    .refine(
      (value) => normalizeMetaPixelId(value) !== undefined,
      "O ID do Meta Pixel tem só números (de 5 a 20 dígitos)."
    ),
  googleTagId: z
    .string()
    .trim()
    .max(40, "Use o formato G-XXXXXXX, GT-XXXXXXX ou AW-XXXXXXX.")
    .refine(
      (value) => normalizeGoogleTagId(value) !== undefined,
      "Use o formato G-XXXXXXX, GT-XXXXXXX ou AW-XXXXXXX (contêiner GTM não é aceito)."
    ),
})

export type ListingPublicationSettingsValues = z.infer<typeof listingPublicationSettingsSchema>

import { z } from "zod"

import { MANUAL_ACTIVITY_TYPES } from "@/lib/clientes/constants"

export const activityFormSchema = z.object({
  type: z.enum(MANUAL_ACTIVITY_TYPES),
  body: z
    .string()
    .trim()
    .min(1, "Descreva o que aconteceu.")
    .max(10000, "O texto pode ter no máximo 10.000 caracteres."),
})

export type ActivityFormValues = z.infer<typeof activityFormSchema>

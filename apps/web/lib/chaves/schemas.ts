import { z } from "zod"

import { localInputToIso } from "@/lib/chaves/datetime"

function isGuid(value: string) {
  return z.guid().safeParse(value).success
}

const keyDetailsShape = {
  label: z
    .string()
    .trim()
    .min(1, "Informe um rótulo para a chave.")
    .max(60, "O rótulo pode ter no máximo 60 caracteres."),
  location: z.string().trim().max(200, "O local pode ter no máximo 200 caracteres."),
  notes: z.string().trim().max(2000, "A observação pode ter no máximo 2.000 caracteres."),
}

export const keyCreateSchema = z.object({
  propertyId: z.string().refine(isGuid, "Selecione o imóvel."),
  ...keyDetailsShape,
})

export const keyUpdateSchema = z.object(keyDetailsShape)

export type KeyCreateValues = z.infer<typeof keyCreateSchema>
export type KeyUpdateValues = z.infer<typeof keyUpdateSchema>

export const KEY_TAKER_KINDS = ["member", "client"] as const

export const keyCheckoutSchema = z
  .object({
    takerKind: z.enum(KEY_TAKER_KINDS),
    memberId: z.string(),
    clientId: z.string(),
    dueAt: z.string(),
    notes: z.string().trim().max(2000, "A observação pode ter no máximo 2.000 caracteres."),
  })
  .superRefine((values, ctx) => {
    if (values.takerKind === "member" && !isGuid(values.memberId)) {
      ctx.addIssue({
        code: "custom",
        path: ["memberId"],
        message: "Selecione quem da equipe está retirando a chave.",
      })
    }

    if (values.takerKind === "client" && !isGuid(values.clientId)) {
      ctx.addIssue({
        code: "custom",
        path: ["clientId"],
        message: "Selecione o cliente que está retirando a chave.",
      })
    }

    if (!values.dueAt) {
      ctx.addIssue({
        code: "custom",
        path: ["dueAt"],
        message: "Informe quando a chave deve ser devolvida.",
      })
      return
    }

    const dueAt = localInputToIso(values.dueAt)

    if (!dueAt) {
      ctx.addIssue({
        code: "custom",
        path: ["dueAt"],
        message: "Data e hora inválidas.",
      })
    } else if (Date.parse(dueAt) <= Date.now()) {
      ctx.addIssue({
        code: "custom",
        path: ["dueAt"],
        message: "A devolução prevista precisa ser depois de agora.",
      })
    }
  })

export type KeyCheckoutValues = z.infer<typeof keyCheckoutSchema>

export const keyIdSchema = z.guid("Chave inválida.")

import type { z } from "zod"

export type { ActionResult } from "@/lib/auth/action-result"

export type FieldErrors = Record<string, string>

/** Resultado de Server Action que devolve dados (id criado, URL assinada etc.). */
export type ActionResultWithData<T> =
  { ok: true; data: T; message?: string } | { ok: false; error: string; fieldErrors?: FieldErrors }

/** Primeira mensagem de cada campo, com o caminho em notação de ponto. */
export function toFieldErrors(error: z.ZodError): FieldErrors {
  const fieldErrors: FieldErrors = {}

  for (const issue of error.issues) {
    const key = issue.path.map(String).join(".")

    if (key && !fieldErrors[key]) {
      fieldErrors[key] = issue.message
    }
  }

  return fieldErrors
}

export const INVALID_FIELDS_MESSAGE = "Confira os campos destacados."

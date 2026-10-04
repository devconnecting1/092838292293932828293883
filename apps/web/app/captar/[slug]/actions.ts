"use server"

import { after } from "next/server"
import { z } from "zod"

import { lookupCep } from "@/lib/br/cep"
import { checkFormToken } from "@/lib/captacao/anti-bot"
import { createAnonClient, normalizeSlug } from "@/lib/captacao/public-organization"
import {
  publicCaptureSchema,
  toCapturePayload,
  type PublicCaptureValues,
} from "@/lib/captacao/schemas"
import {
  createRequestNonce,
  getVisitorClientKey,
  readServerKey,
} from "@/lib/captacao/server-request"
import { sendNotificationEmail } from "@/lib/email"

export type CaptureFieldErrors = Partial<Record<keyof PublicCaptureValues, string>>

export type SubmitCaptureResult =
  | { ok: true }
  | {
      ok: false
      error: string
      fieldErrors?: CaptureFieldErrors
      /** Mostra o botão "Recarregar" (token antirrobô vencido ou envio recusado pelo banco). */
      expired?: boolean
    }

const GENERIC_SUBMIT_ERROR = "Não foi possível enviar agora. Tente novamente em instantes."

export type AntiBotFields = {
  /** Token assinado emitido quando a página foi aberta. */
  token: string
  /** Honeypot: campo invisível que pessoas não preenchem. */
  website: string
}

/**
 * Envio do formulário público. Robôs (honeypot preenchido ou envio rápido
 * demais) recebem a mesma resposta de sucesso, sem gravar nada.
 */
export async function submitCaptureRequest(
  rawSlug: string,
  values: PublicCaptureValues,
  antiBot: AntiBotFields
): Promise<SubmitCaptureResult> {
  const slug = normalizeSlug(String(rawSlug ?? ""))

  if (!slug) {
    return { ok: false, error: "Imobiliária não encontrada." }
  }

  if (typeof antiBot?.website !== "string" || antiBot.website.trim() !== "") {
    return { ok: true }
  }

  const tokenCheck = checkFormToken(antiBot.token, slug)

  if (tokenCheck === "too-fast") {
    return { ok: true }
  }

  if (tokenCheck !== "ok") {
    return {
      ok: false,
      expired: true,
      error: "Este formulário ficou aberto por muito tempo. Recarregue a página e envie de novo.",
    }
  }

  const parsed = publicCaptureSchema.safeParse(values)

  if (!parsed.success) {
    const fieldErrors: CaptureFieldErrors = {}

    for (const issue of parsed.error.issues) {
      const field = issue.path[0] as keyof PublicCaptureValues | undefined

      if (field && !fieldErrors[field]) {
        fieldErrors[field] = issue.message
      }
    }

    return { ok: false, error: "Confira os campos destacados.", fieldErrors }
  }

  // Chave do servidor (segredo do Vault): sem ela a RPC recusa qualquer envio.
  const serverKey = readServerKey("CAPTURE_SERVER_KEY")

  if (!serverKey) {
    return { ok: false, error: GENERIC_SUBMIT_ERROR }
  }

  const clientKey = await getVisitorClientKey()
  const supabase = createAnonClient()
  const { data: captureId, error } = await supabase.rpc("submit_capture_request", {
    org_slug: slug,
    payload: toCapturePayload(parsed.data),
    p_server_key: serverKey,
    p_nonce: createRequestNonce(),
    ...(clientKey ? { p_client_key: clientKey } : {}),
  })

  if (error) {
    switch (error.code) {
      case "42501":
        // Chave do servidor ou nonce recusados (o banco não diz o motivo).
        return {
          ok: false,
          expired: true,
          error: "Não foi possível enviar o formulário. Recarregue a página e tente de novo.",
        }
      case "54000":
        return {
          ok: false,
          error:
            error.details?.trim() === "client_key"
              ? "Você já enviou vários cadastros. Aguarde alguns minutos."
              : "Recebemos muitos cadastros agora. Tente em instantes.",
        }
      case "P0002":
        return {
          ok: false,
          error: "Página não encontrada: esta imobiliária não está mais disponível neste endereço.",
        }
      case "22023":
        // Validações da própria função, já em pt-BR.
        return { ok: false, error: error.message }
      default:
        // Só o código: nada de dados do formulário no log.
        console.error(`[captar] submit_capture_request falhou: ${error.code ?? "erro"}`)
        return { ok: false, error: GENERIC_SUBMIT_ERROR }
    }
  }

  if (typeof captureId === "string") {
    after(() =>
      sendNotificationEmail("capture_request", {
        organizationSlug: slug,
        captureRequestId: captureId,
        request: {
          propertyType: parsed.data.type || null,
          purpose: parsed.data.purpose,
          neighborhood: parsed.data.neighborhood || null,
          city: parsed.data.city || null,
          state: parsed.data.state || null,
        },
      })
    )
  }

  return { ok: true }
}

export type PostalCodeLookupResult =
  | { ok: true; data: { neighborhood: string; city: string; state: string } }
  | { ok: false; error: string }

export async function lookupPostalCode(value: string): Promise<PostalCodeLookupResult> {
  const digits = z.string().max(20).safeParse(value)
  const postalCode = digits.success ? digits.data.replace(/\D/g, "") : ""

  if (postalCode.length !== 8) {
    return { ok: false, error: "CEP inválido." }
  }

  const address = await lookupCep(postalCode)

  if (!address) {
    return {
      ok: false,
      error: "CEP não encontrado. Preencha o endereço manualmente.",
    }
  }

  return {
    ok: true,
    data: {
      neighborhood: address.neighborhood,
      city: address.city,
      state: address.state,
    },
  }
}

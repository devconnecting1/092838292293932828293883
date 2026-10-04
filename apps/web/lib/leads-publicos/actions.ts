"use server"

import { checkFormToken, issueFormToken } from "@/lib/captacao/anti-bot"
import {
  createRequestNonce,
  getVisitorClientKey,
  readServerKey,
} from "@/lib/captacao/server-request"
import {
  sanitizeClickIds,
  sanitizeLandingUrl,
  sanitizeLeadOrigin,
  sanitizeReferrer,
  sanitizeUtm,
} from "@/lib/leads-publicos/attribution"
import {
  isUuid,
  landingLeadSchema,
  toLandingLeadPayload,
  type LandingLeadValues,
} from "@/lib/leads-publicos/schemas"
import { landingTokenScope, normalizeOrgSlug, normalizePageSlug } from "@/lib/leads-publicos/slugs"
import { createLandingAnonClient } from "@/lib/leads-publicos/supabase"

export type LeadFieldErrors = Partial<Record<keyof LandingLeadValues, string>>

export type LandingAntiBotFields = {
  /** Token assinado emitido por issueLandingFormToken quando o formulário montou. */
  token: string
  /** Honeypot: campo invisível que pessoas não preenchem. */
  website: string
}

export type SubmitLandingLeadInput = {
  orgSlug: string
  pageSlug: string
  values: LandingLeadValues
  antiBot: LandingAntiBotFields
  /** { utm, clickIds, referrer, landingUrl } do navegador: saneado de novo aqui. */
  attribution?: unknown
  /** UUID gerado no navegador e repetido nos eventos do Pixel/Google. */
  eventId?: unknown
}

export type SubmitLandingLeadResult =
  | { ok: true }
  | {
      ok: false
      error: string
      fieldErrors?: LeadFieldErrors
      expired?: boolean
    }

export type IssueLandingFormTokenResult = { ok: true; token: string } | { ok: false; error: string }

const PAGE_UNAVAILABLE = "Esta página não está mais disponível."
const GENERIC_ERROR = "Não foi possível enviar agora. Tente novamente em instantes."
const RELOAD_ERROR = "Não foi possível enviar o formulário. Recarregue a página e tente de novo."
const MAX_DB_MESSAGE_LENGTH = 300

function readSlugs(orgSlug: unknown, pageSlug: unknown) {
  const org = normalizeOrgSlug(String(orgSlug ?? ""))
  const page = normalizePageSlug(String(pageSlug ?? ""))

  return org && page ? { org, page } : null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/**
 * Emite o token antirrobô do formulário. A landing page é estática (ISR), então
 * o token não pode ir no HTML: o formulário pede um ao montar.
 */
export async function issueLandingFormToken(
  orgSlug: string,
  pageSlug: string
): Promise<IssueLandingFormTokenResult> {
  const slugs = readSlugs(orgSlug, pageSlug)

  if (!slugs) {
    return { ok: false, error: PAGE_UNAVAILABLE }
  }

  return {
    ok: true,
    token: issueFormToken(landingTokenScope(slugs.org, slugs.page)),
  }
}

/**
 * Envio do formulário de lead de uma landing page publicada. Robôs (honeypot
 * preenchido ou envio rápido demais) recebem a mesma resposta de sucesso, sem
 * gravar nada. Nunca registra dados pessoais no log.
 */
export async function submitLandingLead(
  input: SubmitLandingLeadInput
): Promise<SubmitLandingLeadResult> {
  const slugs = readSlugs(input?.orgSlug, input?.pageSlug)

  if (!slugs) {
    return { ok: false, error: PAGE_UNAVAILABLE }
  }

  const antiBot = input.antiBot

  if (typeof antiBot?.website !== "string" || antiBot.website.trim() !== "") {
    return { ok: true }
  }

  const tokenCheck = checkFormToken(antiBot.token, landingTokenScope(slugs.org, slugs.page))

  if (tokenCheck === "too-fast") {
    return { ok: true }
  }

  if (tokenCheck !== "ok") {
    return {
      ok: false,
      expired: true,
      error: "Este formulário ficou aberto por muito tempo. Confira os dados e envie de novo.",
    }
  }

  const parsed = landingLeadSchema.safeParse(input.values)

  if (!parsed.success) {
    const fieldErrors: LeadFieldErrors = {}

    for (const issue of parsed.error.issues) {
      const field = issue.path[0] as keyof LandingLeadValues | undefined

      if (field && !fieldErrors[field]) {
        fieldErrors[field] = issue.message
      }
    }

    return { ok: false, error: "Confira os campos destacados.", fieldErrors }
  }

  // Loga só o nome da variável ausente (lib/captacao/server-request.ts).
  const serverKey = readServerKey("LEAD_SERVER_KEY")

  if (!serverKey) {
    return { ok: false, error: GENERIC_ERROR }
  }

  const attribution = isRecord(input.attribution) ? input.attribution : {}
  const payload = toLandingLeadPayload(parsed.data, {
    utm: sanitizeUtm(attribution.utm),
    origin: sanitizeLeadOrigin(attribution.origin),
    clickIds: sanitizeClickIds(attribution.clickIds),
    referrer: sanitizeReferrer(attribution.referrer),
    landingUrl: sanitizeLandingUrl(attribution.landingUrl),
    // Sem um UUID válido do navegador, o lead é gravado mesmo assim (sem deduplicação).
    eventId: isUuid(input.eventId) ? input.eventId.toLowerCase() : crypto.randomUUID(),
  })

  try {
    // Hash HMAC do IP; sem IP ou sem CAPTURE_FORM_SECRET vem null e não é enviado.
    const clientKey = await getVisitorClientKey()
    const supabase = createLandingAnonClient()
    const { error } = await supabase.rpc("submit_landing_lead", {
      p_org_slug: slugs.org,
      p_page_slug: slugs.page,
      p_payload: payload,
      p_server_key: serverKey,
      p_nonce: createRequestNonce(),
      ...(clientKey ? { p_client_key: clientKey } : {}),
    })

    if (!error) {
      // O aviso de lead novo sai da fila do banco (gatilho em public.leads para
      // leads gravados sem sessão), uma vez só, com ou sem rodízio.
      return { ok: true }
    }

    switch (error.code) {
      case "54000":
        return {
          ok: false,
          error:
            error.details === "organization"
              ? "Esta imobiliária recebeu muitos contatos agora há pouco. Tente de novo em alguns minutos."
              : "Recebemos vários envios seus agora há pouco. Aguarde alguns minutos e tente de novo.",
        }
      case "42501":
        // Chave do servidor ou nonce recusados.
        console.error("Envio de lead de landing page recusado (42501)")
        return { ok: false, error: RELOAD_ERROR }
      case "P0002":
        return { ok: false, error: PAGE_UNAVAILABLE }
      case "22023": {
        // Validações da própria função, já em pt-BR.
        const message = error.message?.trim()

        return {
          ok: false,
          error:
            message && message.length <= MAX_DB_MESSAGE_LENGTH
              ? message
              : "Confira os dados informados e tente de novo.",
        }
      }
      default:
        console.error(
          `Falha ao registrar lead de landing page (código ${error.code || "desconhecido"})`
        )
        return { ok: false, error: GENERIC_ERROR }
    }
  } catch (cause) {
    console.error(
      `Falha ao registrar lead de landing page (${cause instanceof Error ? cause.name : "erro"})`
    )
    return { ok: false, error: GENERIC_ERROR }
  }
}

"use server"

import { checkFormToken, issueFormToken } from "@/lib/captacao/anti-bot"
import {
  createRequestNonce,
  getVisitorClientKey,
  readServerKey,
} from "@/lib/captacao/server-request"
import { normalizePublicOrgSlug } from "@/lib/imovel-publico/queries"
import { normalizePublicPropertyCode } from "@/lib/imovel-publico/urls"
import type {
  IssueLandingFormTokenResult,
  LandingAntiBotFields,
  LeadFieldErrors,
  SubmitLandingLeadResult,
} from "@/lib/leads-publicos/actions"
import {
  sanitizeClickIds,
  sanitizeLandingUrl,
  sanitizeReferrer,
  sanitizeUtm,
} from "@/lib/leads-publicos/attribution"
import {
  isUuid,
  landingLeadSchema,
  toLandingLeadPayload,
  type LandingLeadValues,
} from "@/lib/leads-publicos/schemas"
import { createLandingAnonClient } from "@/lib/leads-publicos/supabase"

export type SubmitPropertyLeadInput = {
  orgSlug: string
  propertyCode: string
  values: LandingLeadValues
  antiBot: LandingAntiBotFields
  /** { utm, clickIds, referrer, landingUrl } do navegador: saneado de novo aqui. */
  attribution?: unknown
  /** UUID gerado no navegador (idempotência do envio). */
  eventId?: unknown
}

const PROPERTY_UNAVAILABLE = "Este imóvel não está mais disponível."
const GENERIC_ERROR = "Não foi possível enviar agora. Tente novamente em instantes."
const RELOAD_ERROR = "Não foi possível enviar o formulário. Recarregue a página e tente de novo."
const MAX_DB_MESSAGE_LENGTH = 300

function readTarget(orgSlug: unknown, propertyCode: unknown) {
  const org = normalizePublicOrgSlug(String(orgSlug ?? ""))
  const code = normalizePublicPropertyCode(String(propertyCode ?? ""))

  return org && code ? { org, code } : null
}

/**
 * Escopo do token antirrobô (lib/captacao/anti-bot.ts). O prefixo impede usar
 * aqui um token de landing page (`lp:`) ou de /captar e vice-versa.
 */
function propertyTokenScope(orgSlug: string, code: string) {
  return `imovel:${orgSlug}:${code}`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/** Token antirrobô do formulário: a página é estática (ISR), então é pedido ao montar. */
export async function issuePropertyFormToken(
  orgSlug: string,
  propertyCode: string
): Promise<IssueLandingFormTokenResult> {
  const target = readTarget(orgSlug, propertyCode)

  if (!target) {
    return { ok: false, error: PROPERTY_UNAVAILABLE }
  }

  return { ok: true, token: issueFormToken(propertyTokenScope(target.org, target.code)) }
}

/**
 * Formulário de interesse da página pública do imóvel: mesmo fluxo das landing
 * pages (honeypot, token com tempo mínimo, chave do servidor, nonce, hash do
 * IP, consentimento e limites no banco). O lead nasce ligado ao imóvel. Robôs
 * recebem sucesso sem gravar nada. Nunca registra dados pessoais no log.
 */
export async function submitPropertyLead(
  input: SubmitPropertyLeadInput
): Promise<SubmitLandingLeadResult> {
  const target = readTarget(input?.orgSlug, input?.propertyCode)

  if (!target) {
    return { ok: false, error: PROPERTY_UNAVAILABLE }
  }

  const antiBot = input.antiBot

  if (typeof antiBot?.website !== "string" || antiBot.website.trim() !== "") {
    return { ok: true }
  }

  const tokenCheck = checkFormToken(antiBot.token, propertyTokenScope(target.org, target.code))

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

  // Imóvel e tipologia vêm da própria página, nunca do formulário.
  const parsed = landingLeadSchema.safeParse({
    ...(isRecord(input.values) ? input.values : {}),
    propertyId: "",
    typology: "",
  })

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
    clickIds: sanitizeClickIds(attribution.clickIds),
    referrer: sanitizeReferrer(attribution.referrer),
    landingUrl: sanitizeLandingUrl(attribution.landingUrl),
    eventId: isUuid(input.eventId) ? input.eventId.toLowerCase() : crypto.randomUUID(),
  })

  try {
    const clientKey = await getVisitorClientKey()
    const supabase = createLandingAnonClient()
    const { error } = await supabase.rpc("submit_property_lead", {
      p_org_slug: target.org,
      p_property_code: target.code,
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
        console.error("Envio de lead da página do imóvel recusado (42501)")
        return { ok: false, error: RELOAD_ERROR }
      case "P0002":
        return { ok: false, error: PROPERTY_UNAVAILABLE }
      case "22023": {
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
          `Falha ao registrar lead da página do imóvel (código ${error.code || "desconhecido"})`
        )
        return { ok: false, error: GENERIC_ERROR }
    }
  } catch (cause) {
    console.error(
      `Falha ao registrar lead da página do imóvel (${cause instanceof Error ? cause.name : "erro"})`
    )
    return { ok: false, error: GENERIC_ERROR }
  }
}

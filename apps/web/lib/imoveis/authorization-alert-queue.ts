import "server-only"

import { createClient } from "@supabase/supabase-js"
import { z } from "zod"

import { cleanText, isUuid, normalizeEmailAddress } from "@workspace/core/email/sanitize"
import type { Database } from "@workspace/database/types"

import { getSupabaseEnv } from "@/lib/supabase/env"

/**
 * Fila dos avisos de autorização vencendo (private.authorization_alert_notifications).
 * Único ponto de chamada de claim_authorization_alerts e
 * settle_authorization_alerts: RPCs sem sessão, com a chave publishable +
 * NOTIFICATION_SERVER_KEY (segredo notification_server_key do Vault). Nunca
 * service_role.
 *
 * Nada aqui lança: em falha devolve lista vazia ou zeros e registra só o código
 * do erro. Os logs nunca levam e-mail ou nome — só códigos e contagens.
 */

export type AuthorizationAlert = {
  /** Id do aviso na fila: volta no settle e entra na chave de idempotência. */
  id: string
  organizationId: string
  organizationSlug: string
  organizationName: string
  brandColor: string | null
  propertyId: string
  propertyCode: string
  propertyTitle: string
  propertyNeighborhood: string | null
  propertyCity: string | null
  /** AAAA-MM-DD */
  endsOn: string
  daysLeft: number
  milestone: number
  exclusive: boolean
  recipientUserId: string
  recipientEmail: string
  recipientName: string | null
  recipientIsManager: boolean
}

export type AuthorizationAlertSettlement = { sent: number; failed: number; released: number }

/** O banco recorta em 500 por chamada. */
const MAX_CLAIM = 500

const rowSchema = z.object({
  id: z.string(),
  organization_id: z.string(),
  organization_slug: z.string(),
  organization_name: z.string().nullable(),
  brand_color: z.string().nullable(),
  property_id: z.string(),
  property_code: z.string(),
  property_title: z.string(),
  property_neighborhood: z.string().nullable(),
  property_city: z.string().nullable(),
  ends_on: z.string(),
  days_left: z.number(),
  milestone: z.number(),
  exclusive: z.boolean().nullable(),
  recipient_user_id: z.string(),
  recipient_email: z.string(),
  recipient_name: z.string().nullable(),
  recipient_is_manager: z.boolean().nullable(),
})

const settledSchema = z.object({
  sent: z.number(),
  failed: z.number(),
  released: z.number(),
})

/** Cliente sem sessão: a autorização é a NOTIFICATION_SERVER_KEY dentro da RPC. */
function createQueueClient(url: string, publishableKey: string) {
  return createClient<Database>(url, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })
}

function readConfig() {
  const serverKey = process.env.NOTIFICATION_SERVER_KEY?.trim()

  if (!serverKey) {
    console.error("NOTIFICATION_SERVER_KEY ausente")
    return null
  }

  const env = getSupabaseEnv()

  if (!env) {
    console.error("[imoveis/autorizacao] Supabase não configurado")
    return null
  }

  return { serverKey, env }
}

function toAlert(row: z.infer<typeof rowSchema>): AuthorizationAlert | null {
  if (
    !isUuid(row.id) ||
    !isUuid(row.organization_id) ||
    !isUuid(row.property_id) ||
    !isUuid(row.recipient_user_id) ||
    !/^\d{4}-\d{2}-\d{2}$/.test(row.ends_on) ||
    !Number.isInteger(row.days_left)
  ) {
    return null
  }

  const recipientEmail = normalizeEmailAddress(row.recipient_email)
  const organizationSlug = cleanText(row.organization_slug, { maxLength: 63 })

  if (!recipientEmail || !organizationSlug) {
    return null
  }

  return {
    id: row.id,
    organizationId: row.organization_id,
    organizationSlug,
    organizationName: cleanText(row.organization_name, { maxLength: 80 }),
    brandColor: row.brand_color,
    propertyId: row.property_id,
    propertyCode: cleanText(row.property_code, { maxLength: 30 }),
    propertyTitle: cleanText(row.property_title, { maxLength: 200 }),
    propertyNeighborhood: cleanText(row.property_neighborhood, { maxLength: 80 }) || null,
    propertyCity: cleanText(row.property_city, { maxLength: 80 }) || null,
    endsOn: row.ends_on,
    daysLeft: row.days_left,
    milestone: row.milestone,
    exclusive: row.exclusive === true,
    recipientUserId: row.recipient_user_id,
    recipientEmail,
    recipientName: cleanText(row.recipient_name, { maxLength: 120 }) || null,
    recipientIsManager: row.recipient_is_manager === true,
  }
}

/**
 * Enfileira o marco do dia e reserva os avisos pendentes (marca claimed_at e
 * soma uma tentativa). Todo id devolvido precisa voltar em
 * settleAuthorizationAlerts, senão fica preso por 15 min.
 */
export async function claimAuthorizationAlerts(limit: number): Promise<AuthorizationAlert[]> {
  const config = readConfig()

  if (!config) {
    return []
  }

  const size = Number.isFinite(limit) ? Math.min(Math.max(Math.floor(limit), 1), MAX_CLAIM) : 1

  try {
    const supabase = createQueueClient(config.env.url, config.env.publishableKey)
    const { data, error } = await supabase.rpc("claim_authorization_alerts", {
      p_server_key: config.serverKey,
      p_limit: size,
    })

    if (error) {
      console.error(
        `[imoveis/autorizacao] claim_authorization_alerts falhou (código ${error.code || "desconhecido"})`
      )
      return []
    }

    if (!Array.isArray(data)) {
      console.error("[imoveis/autorizacao] claim_authorization_alerts: resposta inesperada")
      return []
    }

    const alerts: AuthorizationAlert[] = []
    let discarded = 0

    for (const row of data) {
      const parsed = rowSchema.safeParse(row)
      const alert = parsed.success ? toAlert(parsed.data) : null

      if (!alert) {
        discarded += 1
        continue
      }

      alerts.push(alert)
    }

    if (discarded > 0) {
      console.error(
        `[imoveis/autorizacao] claim: ${discarded} aviso(s) com dados inválidos descartado(s)`
      )
    }

    return alerts
  } catch (cause) {
    console.error(
      `[imoveis/autorizacao] claim_authorization_alerts falhou (${cause instanceof Error ? cause.name : "erro"})`
    )
    return []
  }
}

function uniqueIds(ids: readonly string[], exclude: ReadonlySet<string>) {
  return [...new Set(ids.filter((id) => isUuid(id) && !exclude.has(id)))]
}

/**
 * Confirma os enviados, devolve à fila os que falharam (conta tentativa) e os
 * que nem foram tentados (não conta). Chame sempre depois do claim.
 */
export async function settleAuthorizationAlerts({
  sent,
  failed,
  released,
}: {
  sent: readonly string[]
  failed: readonly string[]
  released: readonly string[]
}): Promise<AuthorizationAlertSettlement> {
  const empty: AuthorizationAlertSettlement = { sent: 0, failed: 0, released: 0 }
  const sentIds = uniqueIds(sent, new Set())
  const failedIds = uniqueIds(failed, new Set(sentIds))
  const releasedIds = uniqueIds(released, new Set([...sentIds, ...failedIds]))

  if (sentIds.length + failedIds.length + releasedIds.length === 0) {
    return empty
  }

  const config = readConfig()

  if (!config) {
    return empty
  }

  try {
    const supabase = createQueueClient(config.env.url, config.env.publishableKey)
    const { data, error } = await supabase.rpc("settle_authorization_alerts", {
      p_server_key: config.serverKey,
      p_sent: sentIds,
      p_failed: failedIds,
      p_released: releasedIds,
    })

    if (error) {
      console.error(
        `[imoveis/autorizacao] settle_authorization_alerts falhou (código ${error.code || "desconhecido"})`
      )
      return empty
    }

    const parsed = settledSchema.safeParse(data)

    if (!parsed.success) {
      console.error("[imoveis/autorizacao] settle_authorization_alerts: resposta inesperada")
      return empty
    }

    return parsed.data
  } catch (cause) {
    console.error(
      `[imoveis/autorizacao] settle_authorization_alerts falhou (${cause instanceof Error ? cause.name : "erro"})`
    )
    return empty
  }
}

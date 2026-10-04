import "server-only"

import { randomUUID } from "node:crypto"

import { createClient, type SupabaseClient } from "@supabase/supabase-js"

import {
  parseEmailDailyLimit,
  sendWithinEmailQuota,
  type EmailQuotaReservation,
} from "@workspace/core/email/quota"
import { isUuid } from "@workspace/core/email/sanitize"
import type { Database } from "@workspace/database/types"

import type { EmailProvider } from "@/lib/email/types"
import { getSupabaseEnv } from "@/lib/supabase/env"

/**
 * Cota diária de e-mail com prioridade por tipo de aviso. Todo envio real (Brevo)
 * passa por aqui: reserva no banco (reserve_email_send) com o teto da classe
 * (@workspace/core/email/quota), envia e confirma (settle_email_send). Negado ou
 * com falha, o aviso fica marcado como não enviado no banco — só tipo, motivo,
 * imobiliária e o hash da chave de idempotência — e aparece no Painel (dono e
 * gerente) e na Saúde do sistema do Console.
 *
 * - EMAIL_DAILY_LIMIT: envios por dia da conta (padrão 300, Brevo Free).
 * - Autorização das RPCs: NOTIFICATION_SERVER_KEY (nunca service_role).
 * - Modo simulado (sem BREVO_API_KEY) não passa por aqui: nada sai, nada conta.
 * - Logs só com o nome da RPC e o código do erro.
 */

const SAFE_KIND = /^[a-z][a-z0-9_]{2,39}$/
const OTHER_KIND = "other"

let warnedMissingKey = false

type QuotaContext = { serverKey: string; supabase: SupabaseClient<Database> }

let cachedContext: { key: string; context: QuotaContext } | null = null

function getQuotaContext(): QuotaContext | null {
  const serverKey = process.env.NOTIFICATION_SERVER_KEY?.trim()
  const env = getSupabaseEnv()

  if (!serverKey || !env) {
    if (!warnedMissingKey) {
      warnedMissingKey = true
      console.error("[email/cota] NOTIFICATION_SERVER_KEY ou Supabase ausente: contador desligado")
    }
    return null
  }

  const cacheKey = `${env.url}|${serverKey.length}`

  if (cachedContext?.key !== cacheKey) {
    cachedContext = {
      key: cacheKey,
      context: {
        serverKey,
        supabase: createClient<Database>(env.url, env.publishableKey, {
          auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
        }),
      },
    }
  }

  return cachedContext.context
}

function logRpcFailure(rpc: string, code: string | null | undefined) {
  console.error(`[email/cota] ${rpc} falhou (código ${code || "desconhecido"})`)
}

function readReservation(data: unknown): EmailQuotaReservation {
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    return { status: "unavailable" }
  }

  const record = data as Record<string, unknown>

  if (
    record.ok === true &&
    typeof record.day === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(record.day)
  ) {
    return { status: "reserved", day: record.day }
  }

  return record.ok === false ? { status: "denied" } : { status: "unavailable" }
}

/** Limite diário configurado (EMAIL_DAILY_LIMIT, padrão 300). */
export function readEmailDailyLimit(): number {
  return parseEmailDailyLimit(process.env.EMAIL_DAILY_LIMIT)
}

/**
 * Envolve o provedor real: cada `send` reserva na cota do dia antes e confirma
 * depois. Nunca lança; negado pela cota volta `{ ok: false, reason: "daily_quota" }`.
 */
export function withEmailQuota(provider: EmailProvider): EmailProvider {
  return {
    kind: provider.kind,
    async send(message) {
      const kind =
        message.quota && SAFE_KIND.test(message.quota.kind) ? message.quota.kind : OTHER_KIND
      const organizationSlug = message.quota?.organizationSlug?.trim() || null
      // A mesma chave vai para a Brevo e identifica o aviso no banco.
      const noticeKey = isUuid(message.idempotencyKey)
        ? message.idempotencyKey.toLowerCase()
        : randomUUID()

      return sendWithinEmailQuota({
        kind,
        dailyLimit: readEmailDailyLimit(),
        async reserve({ priority, ceiling }) {
          const context = getQuotaContext()

          if (!context) {
            return { status: "unavailable" }
          }

          const { data, error } = await context.supabase.rpc("reserve_email_send", {
            p_server_key: context.serverKey,
            p_priority: priority,
            p_ceiling: ceiling,
            p_kind: kind,
            p_notice_key: noticeKey,
            p_organization_slug: organizationSlug ?? undefined,
          })

          if (error) {
            logRpcFailure("reserve_email_send", error.code)
            return { status: "unavailable" }
          }

          return readReservation(data)
        },
        send: () => provider.send({ ...message, idempotencyKey: noticeKey }),
        async settle({ day, priority, sent, reason }) {
          const context = getQuotaContext()

          if (!context) {
            return
          }

          const { error } = await context.supabase.rpc("settle_email_send", {
            p_server_key: context.serverKey,
            p_day: day,
            p_priority: priority,
            p_kind: kind,
            p_notice_key: noticeKey,
            p_organization_slug: organizationSlug ?? undefined,
            p_sent: sent,
            p_reason: reason ?? undefined,
          })

          if (error) {
            logRpcFailure("settle_email_send", error.code)
          }
        },
      })
    },
  }
}

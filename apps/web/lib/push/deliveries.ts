import "server-only"

import { createClient } from "@supabase/supabase-js"
import { z } from "zod"

import { isUuid } from "@workspace/core/email/sanitize"

import { getVapidConfig } from "@/lib/push/config"
import type { PushDeliveryOptions, PushPayload } from "@/lib/push/messages"
import { mapWithConcurrency, sendWebPush, type PushTarget } from "@/lib/push/send"
import { getSupabaseEnv } from "@/lib/supabase/env"

/**
 * Peças comuns dos pushes que saem das filas do banco (aviso de lead, visita
 * marcada, lembrete de tarefa): leitura dos aparelhos devolvidos pelas RPCs,
 * envio em paralelo e registro de entrega / remoção de inscrição expirada.
 * Nada aqui lança nem registra endpoint ou chave; logs só com contagens.
 */

export type PushTargetWithId = PushTarget & { subscriptionId: string }

export type PushBatchResult = {
  attempted: number
  delivered: number
  failed: number
  removed: number
}

export const EMPTY_PUSH_RESULT: PushBatchResult = {
  attempted: 0,
  delivered: 0,
  failed: 0,
  removed: 0,
}

/** Envios simultâneos ao serviço de push por aviso. */
const CONCURRENCY = 6

/** Teto de aparelhos por pessoa (o banco já guarda no máximo 10). */
const MAX_TARGETS = 10

const settledSchema = z.object({ delivered: z.number(), removed: z.number() })

const pushTargetSchema = z.object({
  subscription_id: z.string(),
  endpoint: z.string(),
  p256dh: z.string(),
  auth: z.string(),
})

/** Aparelhos no formato das RPCs (jsonb `push_targets`); inválidos ficam de fora. */
export function parsePushTargets(value: unknown): PushTargetWithId[] {
  if (!Array.isArray(value)) {
    return []
  }

  const targets: PushTargetWithId[] = []

  for (const item of value.slice(0, MAX_TARGETS)) {
    const parsed = pushTargetSchema.safeParse(item)

    if (parsed.success && isUuid(parsed.data.subscription_id)) {
      targets.push({
        subscriptionId: parsed.data.subscription_id,
        endpoint: parsed.data.endpoint,
        p256dh: parsed.data.p256dh,
        auth: parsed.data.auth,
      })
    }
  }

  return targets
}

export async function settlePushDeliveries(delivered: string[], gone: string[]) {
  const serverKey = process.env.NOTIFICATION_SERVER_KEY?.trim()
  const env = getSupabaseEnv()

  if ((delivered.length === 0 && gone.length === 0) || !serverKey || !env) {
    return { delivered: 0, removed: 0 }
  }

  try {
    const supabase = createClient(env.url, env.publishableKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    })
    const { data, error } = await supabase.rpc("settle_push_deliveries", {
      p_server_key: serverKey,
      p_delivered: delivered,
      p_gone: gone,
    })

    if (error) {
      console.error(`[push] settle_push_deliveries falhou (código ${error.code || "desconhecido"})`)
      return { delivered: 0, removed: 0 }
    }

    const parsed = settledSchema.safeParse(data)
    return parsed.success ? parsed.data : { delivered: 0, removed: 0 }
  } catch (cause) {
    console.error(
      `[push] settle_push_deliveries falhou (${cause instanceof Error ? cause.name : "erro"})`
    )
    return { delivered: 0, removed: 0 }
  }
}

/**
 * Manda a mesma mensagem para os aparelhos de uma pessoa e registra o
 * resultado. Sem chaves VAPID (ou sem aparelho), não envia nada.
 */
export async function pushToTargets(
  targets: readonly PushTargetWithId[],
  message: { payload: PushPayload; options: PushDeliveryOptions }
): Promise<PushBatchResult> {
  const vapid = getVapidConfig()

  if (!vapid || targets.length === 0) {
    return EMPTY_PUSH_RESULT
  }

  try {
    const results = await mapWithConcurrency(targets, CONCURRENCY, async (target) => ({
      subscriptionId: target.subscriptionId,
      ...(await sendWebPush(target, message.payload, message.options, vapid)),
    }))

    const delivered = results
      .filter((result) => result.status === "delivered")
      .map((result) => result.subscriptionId)
    const gone = results
      .filter((result) => result.status === "gone")
      .map((result) => result.subscriptionId)
    const settled = await settlePushDeliveries(delivered, gone)

    return {
      attempted: results.length,
      delivered: delivered.length,
      failed: results.filter((result) => result.status === "failed").length,
      removed: settled.removed,
    }
  } catch (cause) {
    console.error(`[push] envio falhou (${cause instanceof Error ? cause.name : "erro"})`)
    return EMPTY_PUSH_RESULT
  }
}

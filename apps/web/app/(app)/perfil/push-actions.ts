"use server"

import { revalidatePath } from "next/cache"
import { headers } from "next/headers"

import { isUuid } from "@workspace/core/email/sanitize"

import { requireMembership, requireUser } from "@/lib/auth/session"
import { getVapidConfig } from "@/lib/push/config"
import { deviceLabelFromUserAgent } from "@/lib/push/device-label"
import { testPush } from "@/lib/push/messages"
import { sendWebPush } from "@/lib/push/send"
import { isAllowedPushEndpoint, parsePushSubscription } from "@/lib/push/subscription"
import { createClient } from "@/lib/supabase/server"
import { isSubdomainTenancy } from "@/lib/tenant/urls"

/**
 * Avisos no celular em "Meu perfil": ligar e desligar neste aparelho, conferir
 * o estado, mandar um teste e remover aparelhos antigos. Tudo pela sessão do
 * usuário (RLS e RPCs do próprio usuário); endpoint e chaves nunca voltam para
 * o navegador nem vão para log.
 */

export type PushActionResult =
  | { ok: true; subscriptionId: string | null; message?: string }
  | { ok: false; error: string; reason?: "not_registered" | "gone" }

const NOT_AVAILABLE = "Os avisos no celular não estão disponíveis no momento."
const INVALID_SUBSCRIPTION =
  "Este navegador não entregou uma inscrição válida. Atualize a página e tente de novo."

function databaseError(code: string | undefined): string {
  return code === "42501"
    ? "Sua sessão expirou. Entre de novo para mudar os avisos."
    : "Não foi possível salvar agora. Tente de novo em instantes."
}

/** Liga os avisos no aparelho atual (ou atualiza as chaves se já estava ligado). */
export async function enablePushOnDevice(subscription: unknown): Promise<PushActionResult> {
  if (!getVapidConfig()) {
    return { ok: false, error: NOT_AVAILABLE }
  }

  const parsed = parsePushSubscription(subscription)

  if (!parsed) {
    return { ok: false, error: INVALID_SUBSCRIPTION }
  }

  const { membership } = await requireMembership()
  const userAgent = (await headers()).get("user-agent")
  const supabase = await createClient()
  const { data, error } = await supabase.rpc("register_push_subscription", {
    p_endpoint: parsed.endpoint,
    p_p256dh: parsed.keys.p256dh,
    p_auth: parsed.keys.auth,
    p_device_label: deviceLabelFromUserAgent(userAgent) ?? undefined,
    // Subdomínio: o aparelho abre o endereço desta imobiliária e recebe só os
    // avisos dela. Host único: todos os avisos do usuário.
    p_organization_id: isSubdomainTenancy() ? membership.organizationId : undefined,
  })

  if (error || typeof data !== "string") {
    console.error(`[push] register_push_subscription falhou (código ${error?.code ?? "vazio"})`)
    return { ok: false, error: databaseError(error?.code) }
  }

  revalidatePath("/perfil")

  return { ok: true, subscriptionId: data, message: "Avisos ligados neste aparelho." }
}

/**
 * Estado do aparelho atual: devolve o id quando a inscrição deste navegador
 * está ligada para o usuário logado (e atualiza as chaves); null quando não.
 */
export async function getPushDeviceState(subscription: unknown): Promise<PushActionResult> {
  if (!getVapidConfig()) {
    return { ok: false, error: NOT_AVAILABLE }
  }

  const parsed = parsePushSubscription(subscription)

  if (!parsed) {
    return { ok: true, subscriptionId: null }
  }

  await requireUser()
  const supabase = await createClient()
  const { data, error } = await supabase.rpc("sync_push_subscription", {
    p_endpoint: parsed.endpoint,
    p_p256dh: parsed.keys.p256dh,
    p_auth: parsed.keys.auth,
  })

  if (error) {
    console.error(`[push] sync_push_subscription falhou (código ${error.code ?? "vazio"})`)
    return { ok: false, error: databaseError(error.code) }
  }

  return { ok: true, subscriptionId: typeof data === "string" ? data : null }
}

/** Desliga os avisos no aparelho atual (o navegador já cancelou a inscrição). */
export async function disablePushOnDevice(endpoint: unknown): Promise<PushActionResult> {
  if (typeof endpoint !== "string" || !isAllowedPushEndpoint(endpoint)) {
    return { ok: true, subscriptionId: null, message: "Avisos desligados neste aparelho." }
  }

  await requireUser()
  const supabase = await createClient()
  const { error } = await supabase.rpc("unregister_push_subscription", { p_endpoint: endpoint })

  if (error) {
    console.error(`[push] unregister_push_subscription falhou (código ${error.code ?? "vazio"})`)
    return { ok: false, error: databaseError(error.code) }
  }

  revalidatePath("/perfil")

  return { ok: true, subscriptionId: null, message: "Avisos desligados neste aparelho." }
}

/** Remove um aparelho da lista (RLS: só os do próprio usuário). */
export async function removePushDevice(subscriptionId: unknown): Promise<PushActionResult> {
  if (typeof subscriptionId !== "string" || !isUuid(subscriptionId)) {
    return { ok: false, error: "Aparelho não encontrado." }
  }

  await requireUser()
  const supabase = await createClient()
  const { data, error } = await supabase
    .from("push_subscriptions")
    .delete()
    .eq("id", subscriptionId)
    .select("id")

  if (error) {
    console.error(`[push] remover aparelho falhou (código ${error.code ?? "vazio"})`)
    return { ok: false, error: databaseError(error.code) }
  }

  if (!data?.length) {
    return { ok: false, error: "Aparelho não encontrado. Atualize a página." }
  }

  revalidatePath("/perfil")

  return { ok: true, subscriptionId: null, message: "Aparelho removido." }
}

/** Manda a notificação de teste para o aparelho atual. */
export async function sendTestPushToDevice(subscription: unknown): Promise<PushActionResult> {
  const vapid = getVapidConfig()

  if (!vapid) {
    return { ok: false, error: NOT_AVAILABLE }
  }

  const parsed = parsePushSubscription(subscription)

  if (!parsed) {
    return { ok: false, error: INVALID_SUBSCRIPTION }
  }

  await requireUser()
  const supabase = await createClient()

  // Só envia para inscrição ligada deste usuário (e com as chaves atuais).
  const { data, error } = await supabase.rpc("sync_push_subscription", {
    p_endpoint: parsed.endpoint,
    p_p256dh: parsed.keys.p256dh,
    p_auth: parsed.keys.auth,
  })

  if (error) {
    console.error(`[push] sync_push_subscription falhou (código ${error.code ?? "vazio"})`)
    return { ok: false, error: databaseError(error.code) }
  }

  if (typeof data !== "string") {
    return {
      ok: false,
      reason: "not_registered",
      error: "Os avisos não estão ligados neste aparelho. Ligue de novo para testar.",
    }
  }

  const { payload, options } = testPush()
  const result = await sendWebPush(
    { endpoint: parsed.endpoint, p256dh: parsed.keys.p256dh, auth: parsed.keys.auth },
    payload,
    options,
    vapid
  )

  if (result.status === "gone") {
    await supabase.rpc("unregister_push_subscription", { p_endpoint: parsed.endpoint })
    revalidatePath("/perfil")

    return {
      ok: false,
      reason: "gone",
      error: "Este aparelho não aceita mais os avisos. Ligue de novo para voltar a receber.",
    }
  }

  if (result.status === "failed") {
    console.error(`[push] teste não entregue (HTTP ${result.statusCode ?? "sem resposta"})`)
    return {
      ok: false,
      error: "Não conseguimos entregar o teste agora. Tente de novo em instantes.",
    }
  }

  return {
    ok: true,
    subscriptionId: data,
    message: "Notificação de teste enviada. Ela aparece em alguns segundos.",
  }
}

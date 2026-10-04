"use server"

import { randomInt } from "node:crypto"
import { revalidatePath } from "next/cache"
import { headers } from "next/headers"

import { META_WHATSAPP_TERMS } from "@workspace/core/connections"

import { hashVisitorIp, readVisitorIp } from "@/lib/captacao/server-request"
import { getMetaPublicConfig } from "@/lib/conexoes/config"
import {
  connectWhatsappAccount,
  ConnectionRpcError,
  getConnectionCredential,
  registerWhatsappChannel,
  syncWhatsappChannelHealth,
} from "@/lib/conexoes/rpc"
import { readMetaAppSecret } from "@/lib/conexoes/secrets"
import { getActionMembership } from "@/lib/configuracoes/action-context"
import { translateDatabaseError } from "@/lib/configuracoes/errors"
import { createClient } from "@/lib/supabase/server"
import {
  exchangeEmbeddedSignupCode,
  fetchPhoneNumber,
  registerPhoneNumber,
  subscribeAppToWaba,
} from "@/lib/whatsapp/graph"

const PAGE_PATH = "/configuracoes/conexoes"
const TEAM_MANAGERS = ["owner", "manager"] as const

export type ConnectionActionResult = { ok: true; message?: string } | { ok: false; error: string }

export type AcceptTermsResult = { ok: true; acceptanceId: string } | { ok: false; error: string }

const GENERIC_ERROR = "Não foi possível concluir agora. Tente novamente."

const CONNECT_ERRORS: Record<string, string> = {
  aceite_dos_termos_ausente:
    "O aceite dos termos da Meta expirou. Aceite de novo e refaça a conexão.",
  conta_ja_conectada_em_outra_imobiliaria:
    "Esta conta da Meta já está conectada em outra imobiliária da plataforma. Cada imobiliária precisa da conta dela.",
  numero_ja_conectado_em_outra_imobiliaria:
    "Este número já está conectado em outra imobiliária da plataforma.",
  not_configured:
    "O WhatsApp oficial ainda não está configurado nesta instalação. Fale com o suporte.",
}

const GRAPH_ERRORS: Record<string, string> = {
  not_configured: CONNECT_ERRORS.not_configured!,
  unauthorized:
    "A Meta recusou a autorização. Refaça a conexão; se continuar, confira as permissões do app no painel da Meta.",
  rate_limited: "A Meta está limitando as chamadas agora. Tente de novo em alguns minutos.",
  invalid_response: "A Meta respondeu de um jeito que não reconhecemos. Tente de novo.",
  network: "Não conseguimos falar com a Meta agora. Tente de novo.",
  meta_error: "A Meta recusou a operação.",
}

function describeRpcError(error: unknown): string {
  if (error instanceof ConnectionRpcError) {
    return CONNECT_ERRORS[error.code ?? ""] ?? GENERIC_ERROR
  }

  return GENERIC_ERROR
}

/**
 * Grava a prova de aceite dos termos da Meta e devolve o id.
 *
 * É exigência dos Tech Provider Terms §2.1: nenhum cliente pode usar a
 * plataforma antes de aceitar os termos da Meta. A Meta também mostra os termos
 * dela dentro do popup do Embedded Signup, mas não expõe API para consultar
 * esse aceite depois — a evidência auditável é esta, com o texto exibido, a
 * versão, quem aceitou, quando e de onde.
 *
 * O texto vem da constante do core, o mesmo objeto que a tela renderiza: não
 * existe caminho em que o cliente leia um texto e a gente guarde outro.
 */
export async function acceptWhatsappTerms(): Promise<AcceptTermsResult> {
  const auth = await getActionMembership(TEAM_MANAGERS)

  if (!auth.ok) {
    return auth
  }

  const headerList = await headers()
  const supabase = await createClient()

  const { data, error } = await supabase.rpc("accept_connection_terms", {
    p_organization_id: auth.context.membership.organizationId,
    p_provider: "whatsapp",
    p_terms_key: META_WHATSAPP_TERMS.key,
    p_terms_version: META_WHATSAPP_TERMS.version,
    p_terms_url: META_WHATSAPP_TERMS.url,
    p_displayed_text: META_WHATSAPP_TERMS.text,
    p_ip_hash: hashVisitorIp(readVisitorIp(headerList)) ?? undefined,
    p_user_agent: headerList.get("user-agent") ?? undefined,
    p_provider_evidence: {},
  })

  if (error || typeof data !== "string") {
    return { ok: false, error: error ? translateDatabaseError(error) : GENERIC_ERROR }
  }

  return { ok: true, acceptanceId: data }
}

export type FinishConnectionInput = {
  /** `code` do Embedded Signup. Vive 30 segundos: é trocado antes de tudo. */
  code: string
  wabaId: string
  phoneNumberId: string
  businessId: string | null
  termsAcceptanceId: string
}

/**
 * Fecha a conexão do WhatsApp depois do Embedded Signup.
 *
 * Ordem da documentação da Meta: trocar o code → assinar os webhooks da WABA →
 * registrar o número. Só então gravamos, e a credencial vai direto para o Vault
 * pela RPC do servidor — ela nunca passa por coluna de texto nem por log.
 */
export async function finishWhatsappConnection(
  input: FinishConnectionInput
): Promise<ConnectionActionResult> {
  const auth = await getActionMembership(TEAM_MANAGERS)

  if (!auth.ok) {
    return auth
  }

  const config = getMetaPublicConfig()
  const appSecret = readMetaAppSecret()

  if (!config || !appSecret) {
    return { ok: false, error: CONNECT_ERRORS.not_configured! }
  }

  if (!/^[0-9]{5,30}$/.test(input.wabaId) || !/^[0-9]{5,30}$/.test(input.phoneNumberId)) {
    return { ok: false, error: "A Meta devolveu identificadores que não reconhecemos." }
  }

  const exchange = await exchangeEmbeddedSignupCode(input.code, config.appId, appSecret)

  if (!exchange.ok) {
    return { ok: false, error: GRAPH_ERRORS[exchange.reason] ?? GENERIC_ERROR }
  }

  const subscription = await subscribeAppToWaba(input.wabaId, exchange.accessToken)

  if (!subscription.ok) {
    return { ok: false, error: GRAPH_ERRORS[subscription.reason] ?? GENERIC_ERROR }
  }

  // PIN de 2 fatores do número. Ele NÃO é guardado: seria um segredo em coluna
  // de texto, e o schema recusa metadados com cara de segredo. Se um dia o
  // número precisar ser registrado de novo, a imobiliária desliga a verificação
  // em duas etapas no painel da Meta e refaz a conexão.
  const pin = String(randomInt(100_000, 1_000_000))
  const registration = await registerPhoneNumber(input.phoneNumberId, exchange.accessToken, pin)

  // Número que já está registrado devolve erro da Meta e não impede a conexão:
  // o que importa é a WABA estar assinada e a credencial guardada.
  if (!registration.ok && registration.reason === "unauthorized") {
    return { ok: false, error: GRAPH_ERRORS.unauthorized! }
  }

  const phone = await fetchPhoneNumber(input.phoneNumberId, exchange.accessToken)

  try {
    const account = await connectWhatsappAccount({
      organizationId: auth.context.membership.organizationId,
      externalAccountId: input.wabaId,
      externalOwnerId: input.businessId,
      displayName: phone.ok ? phone.info.verifiedName : null,
      scopes: ["whatsapp_business_management", "whatsapp_business_messaging"],
      token: exchange.accessToken,
      tokenExpiresAt: exchange.expiresAt,
      metadata: { graph_version: config.graphVersion },
      connectedBy: auth.context.user.id,
      termsAcceptanceId: input.termsAcceptanceId,
    })

    await registerWhatsappChannel({
      organizationId: auth.context.membership.organizationId,
      connectedAccountId: account.connectedAccountId,
      wabaId: input.wabaId,
      phoneNumberId: input.phoneNumberId,
      displayPhoneNumber: phone.ok ? phone.info.displayPhoneNumber : null,
      verifiedName: phone.ok ? phone.info.verifiedName : null,
    })

    if (phone.ok) {
      await syncWhatsappChannelHealth({
        phoneNumberId: input.phoneNumberId,
        displayPhoneNumber: phone.info.displayPhoneNumber,
        qualityRating: phone.info.qualityRating,
        messagingTier: phone.info.messagingTier,
        throughput: phone.info.throughput,
      })
    }
  } catch (error) {
    return { ok: false, error: describeRpcError(error) }
  }

  revalidatePath(PAGE_PATH)

  return {
    ok: true,
    message:
      "WhatsApp conectado. A partir de agora a Meta cobra o envio direto da imobiliária, no cartão cadastrado na conta dela.",
  }
}

/** Interruptor da imobiliária: desliga sem apagar histórico. */
export async function setConnectionEnabledAction(
  connectedAccountId: string,
  enabled: boolean
): Promise<ConnectionActionResult> {
  const auth = await getActionMembership(TEAM_MANAGERS)

  if (!auth.ok) {
    return auth
  }

  const supabase = await createClient()
  const { error } = await supabase.rpc("set_connection_enabled", {
    p_connected_account_id: connectedAccountId,
    p_enabled: enabled,
  })

  if (error) {
    return { ok: false, error: translateDatabaseError(error) }
  }

  revalidatePath(PAGE_PATH)

  return {
    ok: true,
    message: enabled
      ? "Conexão ligada."
      : "Conexão desligada. Nada foi apagado: o histórico continua aqui.",
  }
}

export async function disconnectConnectionAction(
  connectedAccountId: string
): Promise<ConnectionActionResult> {
  const auth = await getActionMembership(TEAM_MANAGERS)

  if (!auth.ok) {
    return auth
  }

  const supabase = await createClient()
  const { error } = await supabase.rpc("disconnect_connection", {
    p_connected_account_id: connectedAccountId,
  })

  if (error) {
    return { ok: false, error: translateDatabaseError(error) }
  }

  revalidatePath(PAGE_PATH)

  return {
    ok: true,
    message: "Conta desconectada e credencial apagada. As conversas continuam no histórico.",
  }
}

/**
 * Botão "testar": fala com a Meta de verdade, com a credencial guardada, e
 * atualiza nome verificado, qualidade e limite de envio do número.
 *
 * É também a única forma de a nota de qualidade chegar até nós hoje: o webhook
 * `phone_number_quality_update` passou a falar de limite de envio, não de
 * `quality_rating`.
 */
export async function refreshWhatsappChannelAction(
  connectedAccountId: string,
  phoneNumberId: string
): Promise<ConnectionActionResult> {
  const auth = await getActionMembership(TEAM_MANAGERS)

  if (!auth.ok) {
    return auth
  }

  if (!/^[0-9]{5,30}$/.test(phoneNumberId)) {
    return { ok: false, error: GENERIC_ERROR }
  }

  // Confere na sessão que o número é desta imobiliária antes de pedir a
  // credencial ao servidor: a RPC do servidor não faz checagem de tenant.
  const supabase = await createClient()
  const { data: channel, error: channelError } = await supabase
    .from("whatsapp_channels")
    .select("id, connected_account_id")
    .eq("organization_id", auth.context.membership.organizationId)
    .eq("connected_account_id", connectedAccountId)
    .eq("phone_number_id", phoneNumberId)
    .maybeSingle()

  if (channelError || !channel) {
    return { ok: false, error: "Número não encontrado nesta imobiliária." }
  }

  try {
    const credential = await getConnectionCredential(connectedAccountId)
    const phone = await fetchPhoneNumber(phoneNumberId, credential.token)

    if (!phone.ok) {
      return { ok: false, error: GRAPH_ERRORS[phone.reason] ?? GENERIC_ERROR }
    }

    await syncWhatsappChannelHealth({
      phoneNumberId,
      displayPhoneNumber: phone.info.displayPhoneNumber,
      qualityRating: phone.info.qualityRating,
      messagingTier: phone.info.messagingTier,
      throughput: phone.info.throughput,
    })
  } catch (error) {
    return { ok: false, error: describeRpcError(error) }
  }

  revalidatePath(PAGE_PATH)

  return { ok: true, message: "Estado do número atualizado com o que a Meta respondeu agora." }
}

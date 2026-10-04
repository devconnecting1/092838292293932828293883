import "server-only"

import { randomBytes } from "node:crypto"

import { createClient } from "@supabase/supabase-js"

import type { Database, Json } from "@workspace/database/types"

import { readConnectionsServerKey } from "@/lib/conexoes/secrets"
import { getSupabaseEnv } from "@/lib/supabase/env"

/**
 * Único ponto de chamada das RPCs SEM SESSÃO de contas conectadas e WhatsApp.
 *
 * Elas rodam com a chave publishable, no papel `anon`, autenticadas pelo
 * segredo `connections_server_key` do Vault. Nunca service_role: o projeto não
 * tem essa chave em lugar nenhum, de propósito.
 *
 * As RPCs com sessão (aceitar termos, ligar/desligar, enfileirar mensagem) NÃO
 * passam por aqui — elas usam o cliente de sessão e a RLS, em lib/conexoes/actions.
 */

export class ConnectionRpcError extends Error {
  readonly code: string | null

  constructor(operation: string, code: string | null) {
    super(`${operation} falhou (${code ?? "sem código"})`)
    this.name = "ConnectionRpcError"
    this.code = code
  }
}

function serverClient(operation: string) {
  const env = getSupabaseEnv()
  const serverKey = readConnectionsServerKey()

  if (!env || !serverKey) {
    throw new ConnectionRpcError(operation, "not_configured")
  }

  const supabase = createClient<Database>(env.url, env.publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })

  return { supabase, serverKey }
}

/** Nonce de uso único para as RPCs que mudam estado de forma irreversível. */
export function newServerNonce(): string {
  return randomBytes(32).toString("hex")
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function readJsonObject(value: unknown): Record<string, unknown> {
  const row = Array.isArray(value) ? value[0] : value

  return isRecord(row) ? row : {}
}

export type ConnectAccountInput = {
  organizationId: string
  externalAccountId: string
  externalOwnerId: string | null
  displayName: string | null
  scopes: readonly string[]
  token: string
  tokenExpiresAt: string | null
  metadata: Record<string, Json>
  connectedBy: string
  termsAcceptanceId: string
}

export type ConnectAccountResult = {
  connectedAccountId: string
  status: string
  enabled: boolean
  blocked: boolean
}

/** Grava a conta e a credencial no Vault. O token nunca fica em coluna nem em log. */
export async function connectWhatsappAccount(
  input: ConnectAccountInput
): Promise<ConnectAccountResult> {
  const operation = "connect_connection_account"
  const { supabase, serverKey } = serverClient(operation)

  const { data, error } = await supabase.rpc(operation, {
    p_server_key: serverKey,
    p_nonce: newServerNonce(),
    p_organization_id: input.organizationId,
    p_provider: "whatsapp",
    p_external_account_id: input.externalAccountId,
    p_external_owner_id: input.externalOwnerId ?? undefined,
    p_display_name: input.displayName ?? undefined,
    p_handle: undefined,
    p_scopes: [...input.scopes],
    p_token: input.token,
    p_token_expires_at: input.tokenExpiresAt ?? undefined,
    p_metadata: input.metadata,
    p_connected_by: input.connectedBy,
    p_terms_acceptance_id: input.termsAcceptanceId,
  })

  if (error) {
    throw new ConnectionRpcError(operation, error.code || error.message || null)
  }

  const row = readJsonObject(data)

  return {
    connectedAccountId: String(row.connected_account_id ?? ""),
    status: String(row.status ?? "pending"),
    enabled: row.enabled === true,
    blocked: row.blocked === true,
  }
}

export type RegisterChannelInput = {
  organizationId: string
  connectedAccountId: string
  wabaId: string
  phoneNumberId: string
  displayPhoneNumber: string | null
  verifiedName: string | null
}

export async function registerWhatsappChannel(input: RegisterChannelInput): Promise<string> {
  const operation = "register_whatsapp_channel"
  const { supabase, serverKey } = serverClient(operation)

  const { data, error } = await supabase.rpc(operation, {
    p_server_key: serverKey,
    p_nonce: newServerNonce(),
    p_organization_id: input.organizationId,
    p_connected_account_id: input.connectedAccountId,
    p_waba_id: input.wabaId,
    p_phone_number_id: input.phoneNumberId,
    p_display_phone_number: input.displayPhoneNumber ?? undefined,
    p_verified_name: input.verifiedName ?? undefined,
  })

  if (error) {
    throw new ConnectionRpcError(operation, error.code || error.message || null)
  }

  return String(readJsonObject(data).channel_id ?? "")
}

export type ConnectionCredential = {
  token: string
  organizationId: string
  externalAccountId: string
  canSend: boolean
}

/** Credencial em claro, só no servidor. Nunca retorne isto para um componente cliente. */
export async function getConnectionCredential(
  connectedAccountId: string
): Promise<ConnectionCredential> {
  const operation = "get_connection_credential"
  const { supabase, serverKey } = serverClient(operation)

  const { data, error } = await supabase.rpc(operation, {
    p_server_key: serverKey,
    p_connected_account_id: connectedAccountId,
  })

  if (error) {
    throw new ConnectionRpcError(operation, error.code || error.message || null)
  }

  const row = readJsonObject(data)

  return {
    token: String(row.token ?? ""),
    organizationId: String(row.organization_id ?? ""),
    externalAccountId: String(row.external_account_id ?? ""),
    canSend: row.can_send === true,
  }
}

export async function recordConnectionError(
  connectedAccountId: string,
  code: string,
  message: string,
  revoked = false
): Promise<void> {
  const operation = "record_connection_error"
  const { supabase, serverKey } = serverClient(operation)

  const { error } = await supabase.rpc(operation, {
    p_server_key: serverKey,
    p_connected_account_id: connectedAccountId,
    p_code: code,
    p_message: message,
    p_revoked: revoked,
  })

  if (error) {
    throw new ConnectionRpcError(operation, error.code || error.message || null)
  }
}

/**
 * Idempotência da entrega: `true` na primeira vez, `false` em toda reentrega.
 * Entrega repetida é normal; efeito repetido não.
 */
export async function claimWebhookEvent(
  provider: string,
  eventKey: string,
  payloadSha256: string | null
): Promise<boolean> {
  const operation = "record_webhook_event"
  const { supabase, serverKey } = serverClient(operation)

  const { data, error } = await supabase.rpc(operation, {
    p_server_key: serverKey,
    p_provider: provider,
    p_event_key: eventKey,
    p_payload_sha256: payloadSha256 ?? undefined,
  })

  if (error) {
    throw new ConnectionRpcError(operation, error.code || error.message || null)
  }

  return data === true
}

export type IngestMessageInput = {
  phoneNumberId: string
  wamid: string
  contactWaId: string
  contactName: string | null
  body: string | null
  sentAt: string | null
}

export async function ingestWhatsappMessage(input: IngestMessageInput): Promise<void> {
  const operation = "ingest_whatsapp_message"
  const { supabase, serverKey } = serverClient(operation)

  const { error } = await supabase.rpc(operation, {
    p_server_key: serverKey,
    p_phone_number_id: input.phoneNumberId,
    p_wamid: input.wamid,
    p_contact_wa_id: input.contactWaId,
    p_contact_name: input.contactName ?? undefined,
    p_body: input.body ?? undefined,
    p_media: [],
    p_sent_at: input.sentAt ?? undefined,
  })

  if (error) {
    throw new ConnectionRpcError(operation, error.code || error.message || null)
  }
}

export type MessageStatusInput = {
  phoneNumberId: string
  wamid: string
  status: string
  errorCode: number | null
  errorTitle: string | null
  pricingCategory: string | null
  pricingType: string | null
  at: string | null
}

export async function updateWhatsappMessageStatus(input: MessageStatusInput): Promise<void> {
  const operation = "update_whatsapp_message_status"
  const { supabase, serverKey } = serverClient(operation)

  const { error } = await supabase.rpc(operation, {
    p_server_key: serverKey,
    p_phone_number_id: input.phoneNumberId,
    p_wamid: input.wamid,
    p_status: input.status,
    p_error_code: input.errorCode ?? undefined,
    p_error_title: input.errorTitle ?? undefined,
    p_pricing_category: input.pricingCategory ?? undefined,
    p_pricing_type: input.pricingType ?? undefined,
    p_at: input.at ?? undefined,
  })

  if (error) {
    throw new ConnectionRpcError(operation, error.code || error.message || null)
  }
}

export async function setWhatsappMarketingPreference(input: {
  phoneNumberId: string
  contactWaId: string
  value: "stop" | "resume"
  at: string | null
}): Promise<void> {
  const operation = "set_whatsapp_marketing_preference"
  const { supabase, serverKey } = serverClient(operation)

  const { error } = await supabase.rpc(operation, {
    p_server_key: serverKey,
    p_phone_number_id: input.phoneNumberId,
    p_contact_wa_id: input.contactWaId,
    p_value: input.value,
    p_at: input.at ?? undefined,
  })

  if (error) {
    throw new ConnectionRpcError(operation, error.code || error.message || null)
  }
}

export async function syncWhatsappChannelHealth(input: {
  phoneNumberId: string | null
  displayPhoneNumber: string | null
  qualityRating: string | null
  messagingTier: string | null
  throughput: number | null
}): Promise<void> {
  const operation = "sync_whatsapp_channel_health"
  const { supabase, serverKey } = serverClient(operation)

  const { error } = await supabase.rpc(operation, {
    p_server_key: serverKey,
    p_phone_number_id: input.phoneNumberId ?? undefined,
    p_quality_rating: input.qualityRating ?? undefined,
    p_messaging_tier: input.messagingTier ?? undefined,
    p_throughput: input.throughput ?? undefined,
    p_display_phone_number: input.displayPhoneNumber ?? undefined,
  })

  if (error) {
    throw new ConnectionRpcError(operation, error.code || error.message || null)
  }
}

export async function markWhatsappMessageSent(input: {
  messageId: string
  wamid: string | null
  messageStatus: string | null
  errorCode: number | null
  errorTitle: string | null
}): Promise<void> {
  const operation = "mark_whatsapp_message_sent"
  const { supabase, serverKey } = serverClient(operation)

  const { error } = await supabase.rpc(operation, {
    p_server_key: serverKey,
    p_message_id: input.messageId,
    p_wamid: input.wamid ?? undefined,
    p_message_status: input.messageStatus ?? undefined,
    p_error_code: input.errorCode ?? undefined,
    p_error_title: input.errorTitle ?? undefined,
  })

  if (error) {
    throw new ConnectionRpcError(operation, error.code || error.message || null)
  }
}

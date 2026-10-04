import "server-only"

import { createClient } from "@supabase/supabase-js"

import type { LeadIngestProvider, LeadIngestReason } from "@workspace/core/leads/ingest"
import type { Database, Json } from "@workspace/database/types"

import { getSupabaseEnv } from "@/lib/supabase/env"

/**
 * Único ponto de chamada das RPCs de entrada de leads externos.
 *
 * Sem sessão, com a chave publishable + LEAD_INGEST_SERVER_KEY (segredo
 * `lead_ingest_server_key` do Vault). Nunca service_role. É o mesmo molde de
 * lib/billing/rpc.ts e lib/caixa: quem decide o que pode ser gravado é o banco.
 *
 * Nenhuma função daqui registra credencial, token ou dado pessoal em log.
 */

export class LeadIngestRpcError extends Error {
  readonly code: string | null

  constructor(operation: string, code: string | null) {
    super(`${operation} falhou (${code ?? "sem código"})`)
    this.name = "LeadIngestRpcError"
    this.code = code
  }
}

/** Sem a variável de ambiente a entrada fica desligada, e a rota avisa. */
export class LeadIngestNotConfiguredError extends Error {
  constructor() {
    super("LEAD_INGEST_SERVER_KEY ou Supabase ausente")
    this.name = "LeadIngestNotConfiguredError"
  }
}

let warnedMissingServerKey = false

function readServerKey(): string | null {
  const value = process.env.LEAD_INGEST_SERVER_KEY?.trim()

  if (!value) {
    if (!warnedMissingServerKey) {
      warnedMissingServerKey = true
      console.warn(
        "[integracoes] LEAD_INGEST_SERVER_KEY ausente: entrada de leads externos desligada (veja .env.example)"
      )
    }

    return null
  }

  return value
}

/** true quando dá para falar com o banco (usado pelas rotas para responder 503). */
export function isLeadIngestConfigured(): boolean {
  return Boolean(getSupabaseEnv() && readServerKey())
}

function requireClient() {
  const env = getSupabaseEnv()
  const serverKey = readServerKey()

  if (!env || !serverKey) {
    throw new LeadIngestNotConfiguredError()
  }

  const supabase = createClient<Database>(env.url, env.publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })

  return { supabase, serverKey }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null
}

export type IngestOutcome = {
  /** accepted | duplicate | rejected | pending | unknown_account */
  status: string
  reason: LeadIngestReason | null
  leadId: string | null
  organizationId: string | null
}

function toOutcome(raw: unknown): IngestOutcome {
  if (!isRecord(raw)) {
    return { status: "unknown", reason: null, leadId: null, organizationId: null }
  }

  return {
    status: readString(raw.status) ?? "unknown",
    reason: (readString(raw.reason) as LeadIngestReason | null) ?? null,
    leadId: readString(raw.lead_id),
    organizationId: readString(raw.organization_id),
  }
}

/**
 * Canal Pro: a imobiliária vem do token secreto da URL. Token desconhecido
 * devolve `unknown_account` sem dizer se a imobiliária existe.
 */
export async function ingestWebhookLead(token: string, payload: Json): Promise<IngestOutcome> {
  const operation = "ingest_webhook_lead"
  const { supabase, serverKey } = requireClient()
  const { data, error } = await supabase.rpc(operation, {
    p_server_key: serverKey,
    p_token: token,
    p_payload: payload,
  })

  if (error) {
    throw new LeadIngestRpcError(operation, error.code || null)
  }

  return toOutcome(data)
}

/** Meta: registra a chegada do evento antes de buscar os dados no Graph API. */
export async function registerLeadDelivery(input: {
  provider: LeadIngestProvider
  accountId: string
  eventId: string
  occurredAt?: string | null
  origin?: string | null
}): Promise<IngestOutcome & { known: boolean }> {
  const operation = "register_lead_delivery"
  const { supabase, serverKey } = requireClient()
  const { data, error } = await supabase.rpc(operation, {
    p_server_key: serverKey,
    p_provider: input.provider,
    p_external_account_id: input.accountId,
    p_external_event_id: input.eventId,
    p_occurred_at: input.occurredAt ?? undefined,
    p_origin: input.origin ?? undefined,
  })

  if (error) {
    throw new LeadIngestRpcError(operation, error.code || null)
  }

  return {
    ...toOutcome(data),
    known: isRecord(data) && data.known === true,
  }
}

/** Meta: grava o lead depois de buscar os dados. */
export async function ingestExternalLead(input: {
  organizationId: string
  provider: LeadIngestProvider
  payload: Json
}): Promise<IngestOutcome> {
  const operation = "ingest_external_lead"
  const { supabase, serverKey } = requireClient()
  const { data, error } = await supabase.rpc(operation, {
    p_server_key: serverKey,
    p_organization_id: input.organizationId,
    p_provider: input.provider,
    p_payload: input.payload,
  })

  if (error) {
    throw new LeadIngestRpcError(operation, error.code || null)
  }

  return toOutcome(data)
}

/** A origem não respondeu: agenda nova tentativa (ou desiste na 6ª). */
export async function failLeadDelivery(input: {
  organizationId: string
  provider: LeadIngestProvider
  eventId: string
  reason: LeadIngestReason
  detail?: string | null
}): Promise<void> {
  const operation = "fail_lead_delivery"
  const { supabase, serverKey } = requireClient()
  const { error } = await supabase.rpc(operation, {
    p_server_key: serverKey,
    p_organization_id: input.organizationId,
    p_provider: input.provider,
    p_external_event_id: input.eventId,
    p_reason: input.reason,
    p_detail: input.detail ?? undefined,
  })

  if (error) {
    throw new LeadIngestRpcError(operation, error.code || null)
  }
}

export type ClaimedDelivery = {
  organizationId: string
  provider: LeadIngestProvider
  accountId: string
  eventId: string
  attempts: number
}

/** Entregas pendentes que ainda precisam dos dados da origem. */
export async function claimLeadDeliveries(limit: number): Promise<ClaimedDelivery[]> {
  const operation = "claim_lead_deliveries"
  const { supabase, serverKey } = requireClient()
  const { data, error } = await supabase.rpc(operation, {
    p_server_key: serverKey,
    p_limit: limit,
  })

  if (error) {
    throw new LeadIngestRpcError(operation, error.code || null)
  }

  const rows: unknown[] = Array.isArray(data) ? data : []

  return rows.flatMap((row) => {
    if (!isRecord(row)) {
      return []
    }

    const organizationId = readString(row.organization_id)
    const provider = readString(row.provider)
    const accountId = readString(row.external_account_id)
    const eventId = readString(row.external_event_id)

    if (!organizationId || !accountId || !eventId) {
      return []
    }

    if (provider !== "canal_pro" && provider !== "meta_lead_ads") {
      return []
    }

    return [
      {
        organizationId,
        provider,
        accountId,
        eventId,
        attempts: typeof row.attempts === "number" ? row.attempts : 0,
      },
    ]
  })
}

/**
 * Credencial do cliente guardada no Vault (Page access token da Meta). Nunca
 * sai daqui para log, resposta HTTP ou navegador.
 */
export async function readIntegrationSecret(
  organizationId: string,
  provider: LeadIngestProvider
): Promise<string | null> {
  const operation = "read_lead_integration_secret"
  const { supabase, serverKey } = requireClient()
  const { data, error } = await supabase.rpc(operation, {
    p_server_key: serverKey,
    p_organization_id: organizationId,
    p_provider: provider,
  })

  if (error) {
    throw new LeadIngestRpcError(operation, error.code || null)
  }

  return readString(data)
}

/** Resultado de uma conversa com a origem (rodada normal ou teste). */
export async function saveIntegrationState(input: {
  organizationId: string
  provider: LeadIngestProvider
  error?: string | null
  credentialRejected?: boolean
  tested?: boolean
}): Promise<void> {
  const operation = "save_lead_integration_state"
  const { supabase, serverKey } = requireClient()
  const { error } = await supabase.rpc(operation, {
    p_server_key: serverKey,
    p_organization_id: input.organizationId,
    p_provider: input.provider,
    p_error: input.error ?? undefined,
    p_credential_rejected: input.credentialRejected ?? false,
    p_tested: input.tested ?? false,
  })

  if (error) {
    throw new LeadIngestRpcError(operation, error.code || null)
  }
}

/** Registra o teste de conexão no histórico da tela (sem criar lead). */
export async function recordIntegrationTest(input: {
  organizationId: string
  provider: LeadIngestProvider
  detail: string
}): Promise<void> {
  const operation = "record_lead_integration_test"
  const { supabase, serverKey } = requireClient()
  const { error } = await supabase.rpc(operation, {
    p_server_key: serverKey,
    p_organization_id: input.organizationId,
    p_provider: input.provider,
    p_detail: input.detail,
  })

  if (error) {
    throw new LeadIngestRpcError(operation, error.code || null)
  }
}

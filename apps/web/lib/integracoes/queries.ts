import "server-only"

import {
  isLeadIngestProvider,
  LEAD_INGEST_PROVIDERS,
  type LeadDeliveryStatus,
  type LeadIngestProvider,
} from "@workspace/core/leads/ingest"

import { isWebhookToken } from "@/lib/integracoes/constants"
import type { createClient } from "@/lib/supabase/server"

/**
 * Leitura da tela /configuracoes/integracoes, pela RPC
 * get_lead_integrations_overview (dono ou gerente). A resposta do banco é
 * validada aqui antes de chegar aos componentes.
 *
 * O `webhookToken` é o segredo do endereço do Canal Pro: só sai desta RPC e
 * nunca entra em log.
 */

export type LeadIntegration = {
  provider: LeadIngestProvider
  status: "disconnected" | "connected" | "error"
  externalAccountId: string | null
  accountLabel: string | null
  webhookToken: string | null
  hasCredential: boolean
  connectedAt: string | null
  lastEventAt: string | null
  lastSuccessAt: string | null
  lastErrorAt: string | null
  lastError: string | null
  lastTestAt: string | null
}

export type LeadDelivery = {
  id: string
  provider: LeadIngestProvider
  status: LeadDeliveryStatus
  reason: string | null
  detail: string | null
  origin: string | null
  listingCode: string | null
  contactName: string | null
  leadId: string | null
  occurredAt: string | null
  receivedAt: string
}

export type LeadIntegrationsOverview = {
  integrations: Record<LeadIngestProvider, LeadIntegration>
  deliveries: LeadDelivery[]
  /** Contagem dos últimos 30 dias por provedor e situação. */
  totals: Record<LeadIngestProvider, Partial<Record<LeadDeliveryStatus, number>>>
}

const DELIVERY_STATUSES: readonly string[] = [
  "pending",
  "accepted",
  "duplicate",
  "rejected",
  "failed",
  "ignored",
]

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null
}

function disconnected(provider: LeadIngestProvider): LeadIntegration {
  return {
    provider,
    status: "disconnected",
    externalAccountId: null,
    accountLabel: null,
    webhookToken: null,
    hasCredential: false,
    connectedAt: null,
    lastEventAt: null,
    lastSuccessAt: null,
    lastErrorAt: null,
    lastError: null,
    lastTestAt: null,
  }
}

function emptyOverview(): LeadIntegrationsOverview {
  return {
    integrations: {
      canal_pro: disconnected("canal_pro"),
      meta_lead_ads: disconnected("meta_lead_ads"),
    },
    deliveries: [],
    totals: { canal_pro: {}, meta_lead_ads: {} },
  }
}

function toIntegration(raw: unknown): LeadIntegration | null {
  if (!isRecord(raw)) {
    return null
  }

  const provider = raw.provider

  if (!isLeadIngestProvider(provider)) {
    return null
  }

  const status = readString(raw.status)
  const token = readString(raw.webhook_token)

  return {
    provider,
    status: status === "connected" || status === "error" ? status : "disconnected",
    externalAccountId: readString(raw.external_account_id),
    accountLabel: readString(raw.account_label),
    webhookToken: isWebhookToken(token) ? token : null,
    hasCredential: raw.has_credential === true,
    connectedAt: readString(raw.connected_at),
    lastEventAt: readString(raw.last_event_at),
    lastSuccessAt: readString(raw.last_success_at),
    lastErrorAt: readString(raw.last_error_at),
    lastError: readString(raw.last_error),
    lastTestAt: readString(raw.last_test_at),
  }
}

function toDelivery(raw: unknown): LeadDelivery | null {
  if (!isRecord(raw)) {
    return null
  }

  const id = readString(raw.id)
  const provider = raw.provider
  const status = readString(raw.status)
  const receivedAt = readString(raw.received_at)

  if (!id || !isLeadIngestProvider(provider) || !receivedAt || !status) {
    return null
  }

  if (!DELIVERY_STATUSES.includes(status)) {
    return null
  }

  return {
    id,
    provider,
    status: status as LeadDeliveryStatus,
    reason: readString(raw.reason),
    detail: readString(raw.detail),
    origin: readString(raw.origin),
    listingCode: readString(raw.listing_code),
    contactName: readString(raw.contact_name),
    leadId: readString(raw.lead_id),
    occurredAt: readString(raw.occurred_at),
    receivedAt,
  }
}

export function parseLeadIntegrationsOverview(raw: unknown): LeadIntegrationsOverview {
  const overview = emptyOverview()

  if (!isRecord(raw)) {
    return overview
  }

  if (Array.isArray(raw.integrations)) {
    for (const item of raw.integrations) {
      const integration = toIntegration(item)

      if (integration) {
        overview.integrations[integration.provider] = integration
      }
    }
  }

  if (Array.isArray(raw.deliveries)) {
    overview.deliveries = raw.deliveries
      .map(toDelivery)
      .filter((delivery): delivery is LeadDelivery => delivery !== null)
  }

  if (Array.isArray(raw.totals)) {
    for (const item of raw.totals) {
      if (!isRecord(item)) {
        continue
      }

      const provider = item.provider
      const status = readString(item.status)
      const total = typeof item.total === "number" ? item.total : Number(item.total)

      if (!isLeadIngestProvider(provider) || !status || !Number.isFinite(total)) {
        continue
      }

      if (DELIVERY_STATUSES.includes(status)) {
        overview.totals[provider][status as LeadDeliveryStatus] = total
      }
    }
  }

  return overview
}

export type LeadIntegrationsState =
  | { status: "ok"; overview: LeadIntegrationsOverview }
  /** Papel sem acesso (ex.: corretor). Não é erro. */
  | { status: "forbidden" }
  | { status: "error"; message: string }

export async function getLeadIntegrationsOverview(
  supabase: Awaited<ReturnType<typeof createClient>>,
  organizationId: string
): Promise<LeadIntegrationsState> {
  const { data, error } = await supabase.rpc("get_lead_integrations_overview", {
    p_organization_id: organizationId,
    p_limit: 25,
  })

  if (error) {
    if (error.code === "42501") {
      return { status: "forbidden" }
    }

    // Só o código: nada de token nem de dado de contato no log.
    console.error(`[integracoes] get_lead_integrations_overview falhou: ${error.code ?? "erro"}`)

    return {
      status: "error",
      message: "Não foi possível carregar as integrações agora. Tente de novo em instantes.",
    }
  }

  return { status: "ok", overview: parseLeadIntegrationsOverview(data) }
}

export { LEAD_INGEST_PROVIDERS }

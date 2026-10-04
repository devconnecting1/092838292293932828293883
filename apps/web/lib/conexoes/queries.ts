import "server-only"

import {
  connectionHealth,
  CONNECTION_PROVIDER_ORDER,
  CONNECTION_PROVIDERS,
  isConnectionProviderKey,
  isConnectionStatus,
  type ConnectionHealth,
  type ConnectionProviderDefinition,
  type ConnectionProviderKey,
  type ConnectionStatus,
} from "@workspace/core/connections"
import {
  isWhatsappMessagingTier,
  isWhatsappQualityRating,
  type WhatsappMessagingTier,
  type WhatsappQualityRating,
} from "@workspace/core/whatsapp"

import { createClient } from "@/lib/supabase/server"

// `connected_accounts` tem grant de SELECT por COLUNA: `select *` falha de
// propósito, porque `credential_secret_id` e `last_error_message` ficam de fora.
// A lista abaixo é a única leitura permitida — se uma coluna nova precisar
// aparecer na tela, ela também precisa entrar no grant da migração.
const ACCOUNT_COLUMNS = [
  "id",
  "provider",
  "status",
  "enabled",
  "blocked_at",
  "blocked_reason",
  "external_account_id",
  "external_owner_id",
  "display_name",
  "connected_by",
  "connected_at",
  "last_error_code",
  "last_error_at",
  "last_synced_at",
].join(", ")

export type ConnectedAccountView = {
  id: string
  status: ConnectionStatus
  enabled: boolean
  blockedAt: string | null
  blockedReason: string | null
  externalAccountId: string
  externalOwnerId: string | null
  displayName: string | null
  connectedBy: string | null
  connectedAt: string
  lastErrorCode: string | null
  lastErrorAt: string | null
}

export type WhatsappChannelView = {
  id: string
  connectedAccountId: string
  phoneNumberId: string
  displayPhoneNumber: string | null
  verifiedName: string | null
  qualityRating: WhatsappQualityRating
  messagingTier: WhatsappMessagingTier
  enabled: boolean
  autoSuspendedAt: string | null
  autoSuspendedReason: string | null
  lastSyncedAt: string | null
}

export type ConnectionView = {
  provider: ConnectionProviderKey
  definition: ConnectionProviderDefinition
  account: ConnectedAccountView | null
  health: ConnectionHealth
  channels: WhatsappChannelView[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null
}

function toAccount(
  row: unknown
): { provider: ConnectionProviderKey; account: ConnectedAccountView } | null {
  if (!isRecord(row)) {
    return null
  }

  const provider = row.provider
  const status = row.status

  if (!isConnectionProviderKey(provider) || !isConnectionStatus(status)) {
    return null
  }

  const id = readString(row.id)
  const externalAccountId = readString(row.external_account_id)
  const connectedAt = readString(row.connected_at)

  if (!id || !externalAccountId || !connectedAt) {
    return null
  }

  return {
    provider,
    account: {
      id,
      status,
      enabled: row.enabled === true,
      blockedAt: readString(row.blocked_at),
      blockedReason: readString(row.blocked_reason),
      externalAccountId,
      externalOwnerId: readString(row.external_owner_id),
      displayName: readString(row.display_name),
      connectedBy: readString(row.connected_by),
      connectedAt,
      lastErrorCode: readString(row.last_error_code),
      lastErrorAt: readString(row.last_error_at),
    },
  }
}

function toChannel(row: unknown): WhatsappChannelView | null {
  if (!isRecord(row)) {
    return null
  }

  const id = readString(row.id)
  const connectedAccountId = readString(row.connected_account_id)
  const phoneNumberId = readString(row.phone_number_id)

  if (!id || !connectedAccountId || !phoneNumberId) {
    return null
  }

  return {
    id,
    connectedAccountId,
    phoneNumberId,
    displayPhoneNumber: readString(row.display_phone_number),
    verifiedName: readString(row.verified_name),
    qualityRating: isWhatsappQualityRating(row.quality_rating) ? row.quality_rating : "UNKNOWN",
    messagingTier: isWhatsappMessagingTier(row.messaging_tier)
      ? row.messaging_tier
      : "TIER_NOT_SET",
    enabled: row.enabled === true,
    autoSuspendedAt: readString(row.auto_suspended_at),
    autoSuspendedReason: readString(row.auto_suspended_reason),
    lastSyncedAt: readString(row.last_synced_at),
  }
}

/**
 * Estado das conexões da imobiliária, um item por provedor do catálogo —
 * inclusive os que ainda não foram conectados, que aparecem com o preço que o
 * cliente vai pagar ao fornecedor antes de ele decidir conectar.
 *
 * Nunca lança: a tela de Configurações não pode quebrar porque uma consulta
 * falhou. Em erro, devolve o catálogo sem nenhuma conta conectada.
 */
export async function loadConnections(organizationId: string): Promise<ConnectionView[]> {
  const supabase = await createClient()

  const [accountsResult, channelsResult] = await Promise.all([
    supabase
      .from("connected_accounts")
      .select(ACCOUNT_COLUMNS)
      .eq("organization_id", organizationId),
    supabase
      .from("whatsapp_channels")
      .select(
        "id, connected_account_id, phone_number_id, display_phone_number, verified_name, quality_rating, messaging_tier, enabled, auto_suspended_at, auto_suspended_reason, last_synced_at"
      )
      .eq("organization_id", organizationId),
  ])

  if (accountsResult.error) {
    console.error(`[conexoes] falha ao carregar contas conectadas (${accountsResult.error.code})`)
  }

  if (channelsResult.error) {
    console.error(`[conexoes] falha ao carregar números do WhatsApp (${channelsResult.error.code})`)
  }

  const accounts = new Map<ConnectionProviderKey, ConnectedAccountView>()

  for (const row of accountsResult.data ?? []) {
    const parsed = toAccount(row)

    if (parsed) {
      accounts.set(parsed.provider, parsed.account)
    }
  }

  const channels: WhatsappChannelView[] = []

  for (const row of channelsResult.data ?? []) {
    const parsed = toChannel(row)

    if (parsed) {
      channels.push(parsed)
    }
  }

  return CONNECTION_PROVIDER_ORDER.map((provider) => {
    const account = accounts.get(provider) ?? null

    return {
      provider,
      definition: CONNECTION_PROVIDERS[provider],
      account,
      health: connectionHealth(
        account
          ? { status: account.status, enabled: account.enabled, blockedAt: account.blockedAt }
          : null
      ),
      channels:
        provider === "whatsapp" && account
          ? channels.filter((channel) => channel.connectedAccountId === account.id)
          : [],
    }
  })
}

import "server-only"

import type { BillingState } from "@workspace/core/billing/state"
import {
  isAccountSituation,
  isPlatformAccountActionErrorCode,
  PLATFORM_ACCOUNT_ACTION_ERRORS,
  PLATFORM_ORGANIZATIONS_PAGE_SIZE,
  resolveAccountSituation,
  type AccountSituation,
  type OrganizationListFilters,
  type TrialExtensionDays,
} from "@workspace/core/platform/accounts"

import {
  PlatformRpcError,
  throwPlatformRpcError,
  withPlatformRpc,
  type PlatformRpcResult,
} from "@/lib/plataforma/rpc"

/**
 * Módulo "Imobiliárias" do Console da Plataforma: lista, ficha e ações
 * (bloquear, desbloquear, prorrogar teste). Tudo por `withPlatformRpc` (confere
 * o administrador de novo e usa PLATFORM_SERVER_KEY). As ações gravam o
 * registro do console DENTRO da RPC, na mesma transação da mudança.
 *
 * Sem dado de cliente final: as RPCs só devolvem contagens da imobiliária e,
 * na ficha, nome, papel e e-mail dos MEMBROS (suporte).
 */

// ---------------------------------------------------------------------------
// Leitura defensiva (o tipo gerado não marca colunas anuláveis das funções)
// ---------------------------------------------------------------------------

type UnknownRecord = Record<string, unknown>

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null
}

function count(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0
}

function integerOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? Math.round(value) : null
}

const BILLING_STATES: readonly BillingState[] = ["trialing", "active", "grace", "read_only"]

function billingState(value: unknown): BillingState {
  return typeof value === "string" && (BILLING_STATES as readonly string[]).includes(value)
    ? (value as BillingState)
    : "read_only"
}

function situation(value: unknown, status: string | null, blockedAt: string | null) {
  return isAccountSituation(value) ? value : resolveAccountSituation(status, blockedAt)
}

// ---------------------------------------------------------------------------
// Lista
// ---------------------------------------------------------------------------

export type PlatformOrganizationRow = {
  id: string
  name: string
  slug: string
  createdAt: string
  planKey: string | null
  interval: string | null
  status: string | null
  situation: AccountSituation
  accessState: BillingState
  trialEndsAt: string | null
  currentPeriodEnd: string | null
  cancelAtPeriodEnd: boolean
  blockedAt: string | null
  activeMembers: number
  ownedListings: number
  leadsLast30Days: number
  aiCostCents: number | null
  aiCapCents: number | null
  lastActivityAt: string | null
}

export type PlatformOrganizationList = {
  rows: PlatformOrganizationRow[]
  total: number
  totalPages: number
}

/** Lista paginada (25 por página) com busca, situação e plano. */
export async function listPlatformOrganizations(
  filters: OrganizationListFilters
): Promise<PlatformRpcResult<PlatformOrganizationList>> {
  const operation = "platform_list_organizations"

  return withPlatformRpc(operation, async ({ supabase, serverKey }) => {
    const { data, error } = await supabase.rpc(operation, {
      p_server_key: serverKey,
      p_search: filters.busca || undefined,
      p_situation: filters.situacao || undefined,
      p_plan: filters.plano || undefined,
      p_limit: PLATFORM_ORGANIZATIONS_PAGE_SIZE,
      p_offset: (filters.pagina - 1) * PLATFORM_ORGANIZATIONS_PAGE_SIZE,
    })

    if (error) {
      throwPlatformRpcError(operation, error)
    }

    if (!Array.isArray(data)) {
      throw new PlatformRpcError(operation, null, "dados_invalidos")
    }

    const rows: PlatformOrganizationRow[] = []
    let total = 0

    for (const raw of data as unknown[]) {
      if (!isRecord(raw)) continue

      const id = text(raw.organization_id)
      const name = text(raw.name)
      const slug = text(raw.slug)
      const createdAt = text(raw.created_at)

      if (!id || !name || !slug || !createdAt) continue

      const status = text(raw.status)
      const blockedAt = text(raw.platform_blocked_at)
      total = Math.max(total, count(raw.total_count))

      rows.push({
        id,
        name,
        slug,
        createdAt,
        planKey: text(raw.plan_key),
        interval: text(raw.billing_interval),
        status,
        situation: situation(raw.situation, status, blockedAt),
        accessState: billingState(raw.access_state),
        trialEndsAt: text(raw.trial_ends_at),
        currentPeriodEnd: text(raw.current_period_end),
        cancelAtPeriodEnd: raw.cancel_at_period_end === true,
        blockedAt,
        activeMembers: count(raw.active_members),
        ownedListings: count(raw.owned_listings),
        leadsLast30Days: count(raw.leads_last_30_days),
        aiCostCents: integerOrNull(raw.ai_cost_cents),
        aiCapCents: integerOrNull(raw.ai_cap_cents),
        lastActivityAt: text(raw.last_activity_at),
      })
    }

    return {
      rows,
      total,
      totalPages: Math.max(1, Math.ceil(total / PLATFORM_ORGANIZATIONS_PAGE_SIZE)),
    }
  })
}

// ---------------------------------------------------------------------------
// Ficha
// ---------------------------------------------------------------------------

export type PlatformOrganizationMember = {
  name: string | null
  email: string | null
  role: string
  active: boolean
  joinedAt: string | null
  lastSignInAt: string | null
}

export type PlatformBillingHistoryEntry = {
  occurredAt: string
  source: string
  changedFields: string[]
  planKey: string | null
  interval: string | null
  status: string | null
  trialEndsAt: string | null
  currentPeriodEnd: string | null
  cancelAtPeriodEnd: boolean
  platformBlocked: boolean
}

export type PlatformOrganizationDetail = {
  id: string
  name: string
  slug: string
  createdAt: string
  billing: {
    planKey: string | null
    interval: string | null
    status: string | null
    situation: AccountSituation
    accessState: BillingState
    seats: number
    trialEndsAt: string | null
    currentPeriodEnd: string | null
    cancelAtPeriodEnd: boolean
    syncedAt: string | null
    firstPaidAt: string | null
    planNetMonthlyCents: number | null
    hasCustomer: boolean
    hasSubscription: boolean
    blockedAt: string | null
    blockedReason: string | null
  } | null
  metrics: {
    activeMembers: number
    ownedListings: number
    leadsLast30Days: number
    aiCostCents: number | null
    aiCapCents: number | null
    aiPeriodStart: string | null
    aiPeriodEnd: string | null
    lastSignInAt: string | null
    lastAuditEventAt: string | null
    lastActivityAt: string | null
  }
  members: PlatformOrganizationMember[]
  history: PlatformBillingHistoryEntry[]
}

function parseDetail(raw: unknown): PlatformOrganizationDetail | null {
  if (!isRecord(raw) || !isRecord(raw.organization)) {
    return null
  }

  const organization = raw.organization
  const id = text(organization.id)
  const name = text(organization.name)
  const slug = text(organization.slug)
  const createdAt = text(organization.created_at)

  if (!id || !name || !slug || !createdAt) {
    return null
  }

  const billingRaw = isRecord(raw.billing) ? raw.billing : null
  const metrics = isRecord(raw.metrics) ? raw.metrics : {}

  const billing = billingRaw
    ? (() => {
        const status = text(billingRaw.status)
        const blockedAt = text(billingRaw.platform_blocked_at)

        return {
          planKey: text(billingRaw.plan_key),
          interval: text(billingRaw.billing_interval),
          status,
          situation: situation(billingRaw.situation, status, blockedAt),
          accessState: billingState(billingRaw.access_state),
          seats: count(billingRaw.seats),
          trialEndsAt: text(billingRaw.trial_ends_at),
          currentPeriodEnd: text(billingRaw.current_period_end),
          cancelAtPeriodEnd: billingRaw.cancel_at_period_end === true,
          syncedAt: text(billingRaw.synced_at),
          firstPaidAt: text(billingRaw.first_paid_at),
          planNetMonthlyCents: integerOrNull(billingRaw.plan_net_monthly_cents),
          hasCustomer: billingRaw.has_customer === true,
          hasSubscription: billingRaw.has_subscription === true,
          blockedAt,
          blockedReason: text(billingRaw.platform_blocked_reason),
        }
      })()
    : null

  const members = Array.isArray(raw.members)
    ? raw.members.filter(isRecord).map((member) => ({
        name: text(member.name),
        email: text(member.email),
        role: text(member.role) ?? "",
        active: member.active === true,
        joinedAt: text(member.joined_at),
        lastSignInAt: text(member.last_sign_in_at),
      }))
    : []

  const history = Array.isArray(raw.history)
    ? raw.history.filter(isRecord).flatMap((entry) => {
        const occurredAt = text(entry.occurred_at)

        if (!occurredAt) {
          return []
        }

        return [
          {
            occurredAt,
            source: text(entry.source) ?? "",
            changedFields: Array.isArray(entry.changed_fields)
              ? entry.changed_fields.filter((field): field is string => typeof field === "string")
              : [],
            planKey: text(entry.plan_key),
            interval: text(entry.billing_interval),
            status: text(entry.status),
            trialEndsAt: text(entry.trial_ends_at),
            currentPeriodEnd: text(entry.current_period_end),
            cancelAtPeriodEnd: entry.cancel_at_period_end === true,
            platformBlocked: entry.platform_blocked === true,
          },
        ]
      })
    : []

  return {
    id,
    name,
    slug,
    createdAt,
    billing,
    metrics: {
      activeMembers: count(metrics.active_members),
      ownedListings: count(metrics.owned_listings),
      leadsLast30Days: count(metrics.leads_last_30_days),
      aiCostCents: integerOrNull(metrics.ai_cost_cents),
      aiCapCents: integerOrNull(metrics.ai_cap_cents),
      aiPeriodStart: text(metrics.ai_period_start),
      aiPeriodEnd: text(metrics.ai_period_end),
      lastSignInAt: text(metrics.last_sign_in_at),
      lastAuditEventAt: text(metrics.last_audit_event_at),
      lastActivityAt: text(metrics.last_activity_at),
    },
    members,
    history,
  }
}

/**
 * Ficha da imobiliária. `data` null = imobiliária inexistente (P0002): a
 * página responde 404.
 */
export async function getPlatformOrganization(
  organizationId: string
): Promise<PlatformRpcResult<PlatformOrganizationDetail | null>> {
  const operation = "platform_get_organization"

  return withPlatformRpc(operation, async ({ supabase, serverKey }) => {
    const { data, error } = await supabase.rpc(operation, {
      p_server_key: serverKey,
      p_organization_id: organizationId,
    })

    if (error?.code === "P0002") {
      return null
    }

    if (error) {
      throwPlatformRpcError(operation, error)
    }

    const detail = parseDetail(data)

    if (!detail) {
      throw new PlatformRpcError(operation, null, "dados_invalidos")
    }

    return detail
  })
}

// ---------------------------------------------------------------------------
// Ações
// ---------------------------------------------------------------------------

export type PlatformAccountActionOutcome =
  { ok: true; message: string } | { ok: false; error: string }

type RpcErrorLike = { code?: string | null; message?: string | null } | null

/**
 * Erros esperados das RPCs de ação (P0001/22023 com código estável e P0002)
 * viram texto pronto; o resto lança e cai no aviso genérico de `withPlatformRpc`.
 * O texto do banco nunca vai para log nem para a tela fora da lista conhecida.
 */
function expectedActionError(operation: string, error: RpcErrorLike): string {
  if (error?.code === "P0002") {
    return "Imobiliária não encontrada."
  }

  if (
    (error?.code === "P0001" || error?.code === "22023") &&
    isPlatformAccountActionErrorCode(error.message)
  ) {
    return PLATFORM_ACCOUNT_ACTION_ERRORS[error.message]
  }

  throwPlatformRpcError(operation, error)
}

function toOutcome(
  result: PlatformRpcResult<PlatformAccountActionOutcome>
): PlatformAccountActionOutcome {
  return result.ok ? result.data : { ok: false, error: result.message }
}

/** Bloqueia ou desbloqueia a conta (somente leitura, IA e envio parados). */
export async function setPlatformOrganizationBlock(input: {
  organizationId: string
  blocked: boolean
  reason: string
}): Promise<PlatformAccountActionOutcome> {
  const operation = "platform_set_organization_block"

  const result = await withPlatformRpc(operation, async ({ supabase, serverKey, admin }) => {
    const { error } = await supabase.rpc(operation, {
      p_server_key: serverKey,
      p_actor_user_id: admin.id,
      p_actor_email: admin.email,
      p_organization_id: input.organizationId,
      p_blocked: input.blocked,
      p_reason: input.reason,
    })

    if (error) {
      return { ok: false as const, error: expectedActionError(operation, error) }
    }

    return {
      ok: true as const,
      message: input.blocked
        ? "Conta bloqueada. A imobiliária ficou em somente leitura."
        : "Conta desbloqueada. O acesso voltou a seguir a assinatura.",
    }
  })

  return toOutcome(result)
}

/** Prorroga o teste grátis local em 7 ou 14 dias (não chama a Stripe). */
export async function extendPlatformTrial(input: {
  organizationId: string
  days: TrialExtensionDays
  reason: string
}): Promise<PlatformAccountActionOutcome> {
  const operation = "platform_extend_trial"

  const result = await withPlatformRpc(operation, async ({ supabase, serverKey, admin }) => {
    const { error } = await supabase.rpc(operation, {
      p_server_key: serverKey,
      p_actor_user_id: admin.id,
      p_actor_email: admin.email,
      p_organization_id: input.organizationId,
      p_days: input.days,
      p_reason: input.reason,
    })

    if (error) {
      return { ok: false as const, error: expectedActionError(operation, error) }
    }

    return { ok: true as const, message: `Teste grátis prorrogado em ${input.days} dias.` }
  })

  return toOutcome(result)
}

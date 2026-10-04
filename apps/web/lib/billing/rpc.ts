import "server-only"

import { createClient } from "@supabase/supabase-js"

import { PLAN_KEYS, type BillingInterval, type BillingPlanKey } from "@workspace/core/billing"
import type { Database } from "@workspace/database/types"

import { getSupabaseEnv } from "@/lib/supabase/env"
import { createClient as createSessionClient } from "@/lib/supabase/server"

/**
 * Único ponto de chamada das RPCs de billing do Supabase.
 *
 * - Sem sessão, com a chave publishable + BILLING_SERVER_KEY (segredo
 *   `billing_server_key` do Vault): get_billing_account_ids,
 *   sync_billing_account, list_billing_reminders e as RPCs do Indique e ganhe.
 *   Nunca service_role.
 * - Com sessão (RLS): get_billing_overview e get_owned_listing_usage.
 *
 * As respostas são validadas antes de sair deste arquivo.
 */

/** Tipos de aviso aceitos por list_billing_reminders (combinados com o banco). */
export const BILLING_REMINDER_KINDS = [
  "trial_ending_3d",
  "trial_ending_1d",
  "past_due",
  "read_only_today",
] as const

export type BillingReminderKind = (typeof BILLING_REMINDER_KINDS)[number]

export type BillingAccountIds = {
  stripeCustomerId: string | null
  stripeSubscriptionId: string | null
  status: string | null
}

/**
 * Payload de sync_billing_account. `stripe_customer_id` é obrigatório; chave
 * ausente ou null mantém o valor atual (usado para só vincular o customer).
 * `trial_ends_at` é recusado pelo banco: quem define é ele.
 */
export type BillingSyncPayload = {
  stripe_customer_id: string
  stripe_subscription_id?: string | null
  plan_key: BillingPlanKey | null
  billing_interval?: BillingInterval | null
  status: string | null
  seats?: number
  /** Pacotes do adicional "+10 imóveis" (0 a 1000); o total já vai em limits.owned_listings. */
  owned_listing_packs?: number
  addon_keys?: string[]
  limits?: Record<string, number>
  features?: string[]
  current_period_end?: string | null
  cancel_at_period_end?: boolean
}

export type BillingReminderRow = {
  organizationId: string
  organizationSlug: string
  organizationName: string
  ownerEmails: string[]
  /** Fim do período que determina o estado (fim do teste, da carência ou início do modo leitura). */
  noticeDate: string | null
}

/**
 * Falha numa RPC de billing. Guarda só o código do Postgres/PostgREST e, quando
 * houver, o código estável levantado pelo banco (ex.: billing_customer_divergente);
 * nunca o texto livre, que pode conter dados.
 */
export class BillingRpcError extends Error {
  readonly code: string | null
  readonly reason: string | null

  constructor(operation: string, code: string | null, reason: string | null) {
    super(`${operation} falhou (${code ?? "sem código"}${reason ? `: ${reason}` : ""})`)
    this.name = "BillingRpcError"
    this.code = code
    this.reason = reason
  }
}

const STABLE_REASON_PATTERN = /\b(billing_[a-z0-9_]+)\b/

function toRpcError(operation: string, error: { code?: string | null; message?: string | null }) {
  const reason = STABLE_REASON_PATTERN.exec(error.message ?? "")?.[1] ?? null
  return new BillingRpcError(operation, error.code || null, reason)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null
}

let warnedMissingServerKey = false

/** Lê BILLING_SERVER_KEY; se ausente, avisa uma vez só com o nome da variável. */
function readBillingServerKey(): string | null {
  const value = process.env.BILLING_SERVER_KEY?.trim()

  if (!value) {
    if (!warnedMissingServerKey) {
      warnedMissingServerKey = true
      console.warn(
        "[billing] BILLING_SERVER_KEY ausente: faturas e sincronização desativadas (veja .env.example)"
      )
    }

    return null
  }

  return value
}

function requireServerKeyClient(operation: string) {
  const env = getSupabaseEnv()
  const serverKey = readBillingServerKey()

  if (!env || !serverKey) {
    throw new BillingRpcError(operation, "not_configured", null)
  }

  const supabase = createClient<Database>(env.url, env.publishableKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  })

  return { supabase, serverKey }
}

/** IDs da Stripe vinculados à imobiliária; null se a imobiliária não existir. */
export async function getBillingAccountIds(
  organizationId: string
): Promise<BillingAccountIds | null> {
  const operation = "get_billing_account_ids"
  const { supabase, serverKey } = requireServerKeyClient(operation)
  const { data, error } = await supabase.rpc(operation, {
    p_server_key: serverKey,
    p_organization_id: organizationId,
  })

  if (error) {
    // Imobiliária inexistente: sem conta de billing (não é falha transitória).
    if (error.code === "P0002") {
      return null
    }

    throw toRpcError(operation, error)
  }

  const row: unknown = Array.isArray(data) ? data[0] : data

  if (!isRecord(row)) {
    return null
  }

  return {
    stripeCustomerId: readString(row.stripe_customer_id),
    stripeSubscriptionId: readString(row.stripe_subscription_id),
    status: readString(row.status),
  }
}

/** Upsert idempotente do resumo de billing da imobiliária. */
export async function syncBillingAccount(
  organizationId: string,
  payload: BillingSyncPayload
): Promise<void> {
  const operation = "sync_billing_account"
  const { supabase, serverKey } = requireServerKeyClient(operation)
  const { error } = await supabase.rpc(operation, {
    p_server_key: serverKey,
    p_organization_id: organizationId,
    p_payload: payload,
  })

  if (error) {
    throw toRpcError(operation, error)
  }
}

/** Imobiliárias que devem receber o aviso do tipo informado hoje. */
export async function listBillingReminders(
  kind: BillingReminderKind
): Promise<BillingReminderRow[]> {
  const operation = "list_billing_reminders"
  const { supabase, serverKey } = requireServerKeyClient(operation)
  const { data, error } = await supabase.rpc(operation, {
    p_server_key: serverKey,
    p_kind: kind,
  })

  if (error) {
    throw toRpcError(operation, error)
  }

  const rows: unknown[] = Array.isArray(data) ? data : []
  const reminders: BillingReminderRow[] = []

  for (const row of rows) {
    if (!isRecord(row)) {
      continue
    }

    const organizationId = readString(row.organization_id)
    const organizationSlug = readString(row.organization_slug)

    if (!organizationId || !organizationSlug) {
      continue
    }

    const ownerEmails = Array.isArray(row.owner_emails)
      ? [...new Set(row.owner_emails.map(readString).filter((email) => email !== null))]
      : []

    reminders.push({
      organizationId,
      organizationSlug,
      organizationName: readString(row.organization_name) ?? "sua imobiliária",
      ownerEmails,
      noticeDate: readString(row.notice_date),
    })
  }

  return reminders
}

// ---------------------------------------------------------------------------
// Indique e ganhe (chave do servidor)

export type ReferralIneligibleReason =
  "refund" | "dispute" | "dispute_lost" | "shared_members" | "same_cnpj" | "duplicate_owner"

const INELIGIBLE_REASONS: readonly string[] = [
  "refund",
  "dispute",
  "dispute_lost",
  "shared_members",
  "same_cnpj",
  "duplicate_owner",
]

export type ReferralStateOrganization = {
  id: string
  slug: string
  name: string
  referralCode: string
  referredByOrganizationId: string | null
  status: string | null
  planKey: BillingPlanKey | null
  interval: BillingInterval | null
  stripeSubscriptionId: string | null
  firstPaidAt: string | null
  referralDiscountPercent: number
  ownerEmails: string[]
  /** Total de indicadas (a lista traz no máximo REFERRAL_STATE_MAX_REFERRALS). */
  referralTotal: number
  referralsTruncated: boolean
  /**
   * Impressão do estado que entra no cálculo (md5 do banco). Devolvida a
   * apply_referral_recalculation: se algum fato de cobrança mudou desde esta
   * leitura, a gravação é recusada (conflito) em vez de sobrescrever um
   * recálculo mais novo. null só com um banco anterior à migração.
   */
  stateFingerprint: string | null
}

export type ReferralStateReferral = {
  organizationId: string
  /** Nome mascarado pelo banco (iniciais ou primeira palavra + inicial). */
  displayName: string
  createdAt: string | null
  status: string | null
  planKey: BillingPlanKey | null
  interval: BillingInterval | null
  firstPaidAt: string | null
  referralDiscountPercent: number
  /** Valor líquido mensal do plano na última fatura paga (trava do desconto). */
  netMonthlyCents: number | null
  countedAt: string | null
  confirmedNotifiedAt: string | null
  ineligibleReason: ReferralIneligibleReason | null
}

export type ReferralState = {
  organization: ReferralStateOrganization
  referrals: ReferralStateReferral[]
}

export type ReferralGraceCompletion = {
  referrerOrganizationId: string
  referredOrganizationId: string
  firstPaidAt: string
}

export type ReferralApplyResult =
  | {
      status: "ok"
      previous: number
      /** Indicadas marcadas como contando nesta chamada. */
      counted: string[]
      /** Indicadas que deixaram de contar nesta chamada (com a marca anterior). */
      uncounted: { organizationId: string; countedAt: string }[]
    }
  | { status: "conflict"; previous: number }

export type ReferralChargeIssue = "refund" | "dispute" | "dispute_lost" | "dispute_won"

const BILLING_PLAN_KEYS: readonly string[] = ["trial", ...PLAN_KEYS]

function readPlanKey(value: unknown): BillingPlanKey | null {
  return typeof value === "string" && BILLING_PLAN_KEYS.includes(value)
    ? (value as BillingPlanKey)
    : null
}

function readInterval(value: unknown): BillingInterval | null {
  return value === "month" || value === "year" ? value : null
}

function readPercent(value: unknown): number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 100
    ? value
    : 0
}

function readCents(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null
}

/** md5 em hex (o banco recusa qualquer outro formato). */
function readFingerprint(value: unknown): string | null {
  return typeof value === "string" && /^[0-9a-f]{32}$/.test(value) ? value : null
}

function readUuidList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map(readString).filter((item): item is string => item !== null)
    : []
}

function toReferralReferral(row: unknown): ReferralStateReferral | null {
  if (!isRecord(row)) {
    return null
  }

  const organizationId = readString(row.organization_id)

  if (!organizationId) {
    return null
  }

  const reason = readString(row.ineligible_reason)

  return {
    organizationId,
    displayName: readString(row.display_name) ?? "Imobiliária",
    createdAt: readString(row.created_at),
    status: readString(row.status),
    planKey: readPlanKey(row.plan_key),
    interval: readInterval(row.billing_interval),
    firstPaidAt: readString(row.first_paid_at),
    referralDiscountPercent: readPercent(row.referral_discount_percent),
    netMonthlyCents: readCents(row.net_monthly_cents),
    countedAt: readString(row.counted_at),
    confirmedNotifiedAt: readString(row.confirmed_notified_at),
    ineligibleReason:
      reason && INELIGIBLE_REASONS.includes(reason) ? (reason as ReferralIneligibleReason) : null,
  }
}

function toReferralState(raw: unknown): ReferralState | null {
  if (!isRecord(raw) || !isRecord(raw.organization)) {
    return null
  }

  const organization = raw.organization
  const id = readString(organization.id)
  const slug = readString(organization.slug)
  const referralCode = readString(organization.referral_code)

  if (!id || !slug || !referralCode) {
    return null
  }

  const ownerEmails = Array.isArray(organization.owner_emails)
    ? [...new Set(organization.owner_emails.map(readString).filter((email) => email !== null))]
    : []
  const referrals = Array.isArray(raw.referrals)
    ? raw.referrals.map(toReferralReferral).filter((item) => item !== null)
    : []

  return {
    organization: {
      id,
      slug,
      name: readString(organization.name) ?? "sua imobiliária",
      referralCode,
      referredByOrganizationId: readString(organization.referred_by_organization_id),
      status: readString(organization.status),
      planKey: readPlanKey(organization.plan_key),
      interval: readInterval(organization.billing_interval),
      stripeSubscriptionId: readString(organization.stripe_subscription_id),
      firstPaidAt: readString(organization.first_paid_at),
      referralDiscountPercent: readPercent(organization.referral_discount_percent),
      ownerEmails,
      referralTotal:
        typeof organization.referral_total === "number"
          ? organization.referral_total
          : referrals.length,
      referralsTruncated: organization.referrals_truncated === true,
      stateFingerprint: readFingerprint(organization.state_fingerprint),
    },
    referrals,
  }
}

/** Imobiliária (código, cobrança, donos) e as indicadas por ela; null se não existir. */
export async function getReferralState(organizationId: string): Promise<ReferralState | null> {
  const operation = "get_referral_state"
  const { supabase, serverKey } = requireServerKeyClient(operation)
  const { data, error } = await supabase.rpc(operation, {
    p_server_key: serverKey,
    p_organization_id: organizationId,
  })

  if (error) {
    if (error.code === "P0002") {
      return null
    }

    throw toRpcError(operation, error)
  }

  const state = toReferralState(data)

  if (!state) {
    throw new BillingRpcError(operation, "unexpected_response", null)
  }

  return state
}

/**
 * Fatura paga de criação ou renovação: grava a 1ª fatura paga (valor > 0, só
 * se ainda não houver) e o valor líquido mensal do plano. true = 1º pagamento agora.
 */
export async function recordBillingInvoicePaid(
  organizationId: string,
  invoice: {
    paidAt: Date
    invoiceCreatedAt: Date
    amountPaidCents: number
    planNetMonthlyCents: number | null
  }
): Promise<boolean> {
  const operation = "record_billing_invoice_paid"
  const { supabase, serverKey } = requireServerKeyClient(operation)
  const { data, error } = await supabase.rpc(operation, {
    p_server_key: serverKey,
    p_organization_id: organizationId,
    p_paid_at: invoice.paidAt.toISOString(),
    p_invoice_created_at: invoice.invoiceCreatedAt.toISOString(),
    p_amount_paid_cents: invoice.amountPaidCents,
    p_plan_net_monthly_cents: invoice.planNetMonthlyCents ?? undefined,
  })

  if (error) {
    throw toRpcError(operation, error)
  }

  return data === true
}

/**
 * Grava o resultado do recálculo se o percentual gravado ainda for o esperado E
 * o estado lido não tiver mudado (senão devolve conflito), com as transições
 * das indicadas.
 */
export async function applyReferralRecalculation(
  organizationId: string,
  input: {
    expectedPercent: number
    percent: number
    count: string[]
    uncount: string[]
    /** state_fingerprint da leitura que gerou este recálculo. */
    stateFingerprint: string | null
  }
): Promise<ReferralApplyResult> {
  const operation = "apply_referral_recalculation"
  const { supabase, serverKey } = requireServerKeyClient(operation)
  const { data, error } = await supabase.rpc(operation, {
    p_server_key: serverKey,
    p_organization_id: organizationId,
    p_expected_percent: input.expectedPercent,
    p_percent: input.percent,
    p_count: input.count,
    p_uncount: input.uncount,
    p_expected_fingerprint: input.stateFingerprint ?? undefined,
  })

  if (error) {
    throw toRpcError(operation, error)
  }

  if (!isRecord(data)) {
    throw new BillingRpcError(operation, "unexpected_response", null)
  }

  const previous = readPercent(data.previous)

  if (data.status === "conflict") {
    return { status: "conflict", previous }
  }

  if (data.status !== "ok") {
    throw new BillingRpcError(operation, "unexpected_response", null)
  }

  const uncounted = Array.isArray(data.uncounted)
    ? data.uncounted.flatMap((item) => {
        if (!isRecord(item)) {
          return []
        }

        const referredId = readString(item.organization_id)
        const countedAt = readString(item.counted_at)
        return referredId && countedAt ? [{ organizationId: referredId, countedAt }] : []
      })
    : []

  return { status: "ok", previous, counted: readUuidList(data.counted), uncounted }
}

/** Reserva (true) ou libera (false) o aviso de confirmação. true = mudou. */
export async function setReferralConfirmationNotice(
  referrerOrganizationId: string,
  referredOrganizationId: string,
  claim: boolean
): Promise<boolean> {
  const operation = "set_referral_confirmation_notice"
  const { supabase, serverKey } = requireServerKeyClient(operation)
  const { data, error } = await supabase.rpc(operation, {
    p_server_key: serverKey,
    p_referrer_organization_id: referrerOrganizationId,
    p_referred_organization_id: referredOrganizationId,
    p_claim: claim,
  })

  if (error) {
    throw toRpcError(operation, error)
  }

  return data === true
}

/** Estorno ou disputa na imobiliária (indicada): true = mudou a elegibilidade. */
export async function setReferralIneligibility(
  organizationId: string,
  issue: ReferralChargeIssue
): Promise<boolean> {
  const operation = "set_referral_ineligibility"
  const { supabase, serverKey } = requireServerKeyClient(operation)
  const { data, error } = await supabase.rpc(operation, {
    p_server_key: serverKey,
    p_organization_id: organizationId,
    p_reason: issue,
  })

  if (error) {
    throw toRpcError(operation, error)
  }

  return data === true
}

/** Uma página das indicadas com a 1ª fatura paga em (paidAfter, paidUntil]. */
export async function listReferralGraceCompletions(input: {
  paidAfter: Date
  paidUntil: Date
  cursor: { paidAt: string; organizationId: string } | null
  limit: number
}): Promise<ReferralGraceCompletion[]> {
  const operation = "list_referral_grace_completions"
  const { supabase, serverKey } = requireServerKeyClient(operation)
  const { data, error } = await supabase.rpc(operation, {
    p_server_key: serverKey,
    p_paid_after: input.paidAfter.toISOString(),
    p_paid_until: input.paidUntil.toISOString(),
    p_cursor_paid_at: input.cursor?.paidAt,
    p_cursor_organization_id: input.cursor?.organizationId,
    p_limit: input.limit,
  })

  if (error) {
    throw toRpcError(operation, error)
  }

  const rows: unknown[] = Array.isArray(data) ? data : []

  return rows.flatMap((row) => {
    if (!isRecord(row)) {
      return []
    }

    const referrerOrganizationId = readString(row.referrer_organization_id)
    const referredOrganizationId = readString(row.referred_organization_id)
    const firstPaidAt = readString(row.first_paid_at)

    return referrerOrganizationId && referredOrganizationId && firstPaidAt
      ? [{ referrerOrganizationId, referredOrganizationId, firstPaidAt }]
      : []
  })
}

/** Uma página de indicadores para a reconciliação (ordem estável por semente). */
export async function listReferralReferrers(input: {
  seed: string
  after: string | null
  limit: number
}): Promise<{ organizationId: string; sortKey: string }[]> {
  const operation = "list_referral_referrers"
  const { supabase, serverKey } = requireServerKeyClient(operation)
  const { data, error } = await supabase.rpc(operation, {
    p_server_key: serverKey,
    p_seed: input.seed,
    p_after: input.after ?? undefined,
    p_limit: input.limit,
  })

  if (error) {
    throw toRpcError(operation, error)
  }

  const rows: unknown[] = Array.isArray(data) ? data : []

  return rows.flatMap((row) => {
    if (!isRecord(row)) {
      return []
    }

    const organizationId = readString(row.organization_id)
    const sortKey = readString(row.sort_key)
    return organizationId && sortKey ? [{ organizationId, sortKey }] : []
  })
}

/** Resposta crua de get_billing_overview (validada em queries.ts). Usa a sessão. */
export async function fetchBillingOverview(organizationId: string): Promise<unknown> {
  const operation = "get_billing_overview"
  const supabase = await createSessionClient()
  const { data, error } = await supabase.rpc(operation, { p_organization_id: organizationId })

  if (error) {
    throw toRpcError(operation, error)
  }

  return data
}

/**
 * Imóveis com foto que contam no limite `owned_listings`, com a sessão do
 * usuário. O banco devolve a mesma contagem que o gatilho usa para barrar
 * (private.owned_listing_count); não membro recebe 42501.
 */
export async function fetchOwnedListingUsage(organizationId: string): Promise<unknown> {
  const operation = "get_owned_listing_usage"
  const supabase = await createSessionClient()
  const { data, error } = await supabase.rpc(operation, { p_organization_id: organizationId })

  if (error) {
    throw toRpcError(operation, error)
  }

  return data
}

/**
 * Console da Plataforma — imobiliárias (contas do SaaS).
 *
 * Regras puras da lista e da ficha em /plataforma/imobiliarias: situação da
 * assinatura, próximo marco (fim do teste, próxima cobrança...), filtros da
 * URL, motivo obrigatório e prorrogação do teste grátis. O banco repete as
 * mesmas regras (migração platform_console_organizations_and_revenue) e é quem
 * decide de verdade; aqui fica o que a tela precisa para mostrar e validar
 * antes de chamar a RPC.
 */

import { GRACE_DAYS, isPlanKey, PLANS, type BillingPlanKey } from "../billing/plans"

// ---------------------------------------------------------------------------
// Situação da assinatura
// ---------------------------------------------------------------------------

/** Mesmos valores de private.platform_account_situation. */
export const ACCOUNT_SITUATIONS = ["teste", "ativa", "em_atraso", "cancelada", "bloqueada"] as const

export type AccountSituation = (typeof ACCOUNT_SITUATIONS)[number]

export const ACCOUNT_SITUATION_LABELS: Record<AccountSituation, string> = {
  teste: "Em teste",
  ativa: "Ativa",
  em_atraso: "Em atraso",
  cancelada: "Cancelada",
  bloqueada: "Bloqueada",
}

export function isAccountSituation(value: unknown): value is AccountSituation {
  return typeof value === "string" && (ACCOUNT_SITUATIONS as readonly string[]).includes(value)
}

const PAYMENT_PENDING_STATUSES: ReadonlySet<string> = new Set(["past_due", "unpaid", "incomplete"])

/**
 * Situação a partir do status da Stripe (billing_accounts.status) e do bloqueio
 * da plataforma. Bloqueio vence tudo; status desconhecido ou sem conta conta
 * como cancelada (igual ao SQL).
 */
export function resolveAccountSituation(
  status: string | null | undefined,
  blockedAt: string | Date | null | undefined
): AccountSituation {
  if (blockedAt) {
    return "bloqueada"
  }

  if (status === "trialing") {
    return "teste"
  }

  if (status === "active") {
    return "ativa"
  }

  return status && PAYMENT_PENDING_STATUSES.has(status) ? "em_atraso" : "cancelada"
}

// ---------------------------------------------------------------------------
// Planos
// ---------------------------------------------------------------------------

export const PLATFORM_PLAN_KEYS: readonly BillingPlanKey[] = [
  "trial",
  "corretor",
  "imobiliaria",
  "equipe",
  "rede",
]

export function isPlatformPlanKey(value: unknown): value is BillingPlanKey {
  return typeof value === "string" && (PLATFORM_PLAN_KEYS as readonly string[]).includes(value)
}

/** "Teste grátis", "Corretor", "Imobiliária"...; chave desconhecida volta como veio. */
export function platformPlanLabel(planKey: string | null | undefined): string {
  if (planKey === "trial") {
    return "Teste grátis"
  }

  if (isPlanKey(planKey)) {
    return PLANS[planKey].name
  }

  return planKey?.trim() ? planKey : "Sem plano"
}

export function billingIntervalLabel(interval: string | null | undefined): string | null {
  if (interval === "month") return "Mensal"
  if (interval === "year") return "Anual"
  return null
}

// ---------------------------------------------------------------------------
// Próximo marco da conta (coluna "Fim do teste ou próxima cobrança")
// ---------------------------------------------------------------------------

export type AccountMilestoneKind =
  "fim_do_teste" | "proxima_cobranca" | "fim_do_acesso" | "fim_da_carencia"

export const ACCOUNT_MILESTONE_LABELS: Record<AccountMilestoneKind, string> = {
  fim_do_teste: "Fim do teste",
  proxima_cobranca: "Próxima cobrança",
  fim_do_acesso: "Cancelamento agendado",
  fim_da_carencia: "Fim da carência",
}

export type AccountMilestoneInput = {
  status: string | null | undefined
  planKey: string | null | undefined
  trialEndsAt: string | null | undefined
  currentPeriodEnd: string | null | undefined
  cancelAtPeriodEnd: boolean
}

export type AccountMilestone = { kind: AccountMilestoneKind; at: string }

const DAY_MS = 24 * 60 * 60 * 1000

function validIso(value: string | null | undefined): string | null {
  return typeof value === "string" && Number.isFinite(Date.parse(value)) ? value : null
}

/**
 * - teste: fim do teste (teste local ou sem período → trial_ends_at; teste
 *   criado na Stripe → current_period_end), a mesma data de billing_state;
 * - ativa: próxima cobrança (ou "cancelamento agendado" quando
 *   cancel_at_period_end), no fim do período;
 * - em atraso: fim da carência (fim do período + 7 dias);
 * - cancelada e o resto: sem marco.
 */
export function resolveAccountMilestone(input: AccountMilestoneInput): AccountMilestone | null {
  const trialEndsAt = validIso(input.trialEndsAt)
  const periodEnd = validIso(input.currentPeriodEnd)

  if (input.status === "trialing") {
    const at = input.planKey === "trial" || !periodEnd ? trialEndsAt : periodEnd
    return at ? { kind: "fim_do_teste", at } : null
  }

  if (input.status === "active") {
    return periodEnd
      ? { kind: input.cancelAtPeriodEnd ? "fim_do_acesso" : "proxima_cobranca", at: periodEnd }
      : null
  }

  if (input.status && PAYMENT_PENDING_STATUSES.has(input.status) && periodEnd) {
    return {
      kind: "fim_da_carencia",
      at: new Date(Date.parse(periodEnd) + GRACE_DAYS * DAY_MS).toISOString(),
    }
  }

  return null
}

// ---------------------------------------------------------------------------
// Uso de IA no ciclo
// ---------------------------------------------------------------------------

/** Fração do teto de IA já gasta (0 a 1+); null sem teto ou sem dado. */
export function aiUsageRatio(
  costCents: number | null | undefined,
  capCents: number | null | undefined
): number | null {
  if (typeof costCents !== "number" || !Number.isFinite(costCents)) {
    return null
  }

  if (typeof capCents !== "number" || !Number.isFinite(capCents) || capCents <= 0) {
    return null
  }

  return Math.max(0, costCents) / capCents
}

// ---------------------------------------------------------------------------
// Ações: motivo obrigatório e prorrogação do teste
// ---------------------------------------------------------------------------

export const ACTION_REASON_MIN_LENGTH = 3
export const ACTION_REASON_MAX_LENGTH = 1000

export type ActionReasonCheck = { ok: true; reason: string } | { ok: false; message: string }

/** Motivo de ação do console: 3 a 1.000 caracteres sem os espaços das pontas. */
export function checkActionReason(value: unknown): ActionReasonCheck {
  const reason = typeof value === "string" ? value.trim() : ""

  if (reason.length < ACTION_REASON_MIN_LENGTH) {
    return { ok: false, message: "Escreva o motivo (pelo menos 3 caracteres)." }
  }

  if (reason.length > ACTION_REASON_MAX_LENGTH) {
    return { ok: false, message: "O motivo pode ter até 1.000 caracteres." }
  }

  return { ok: true, reason }
}

export const TRIAL_EXTENSION_DAYS = [7, 14] as const

export type TrialExtensionDays = (typeof TRIAL_EXTENSION_DAYS)[number]

/** O novo fim do teste não pode passar de agora + 45 dias (mesma trava do banco). */
export const TRIAL_EXTENSION_MAX_AHEAD_DAYS = 45

export function isTrialExtensionDays(value: unknown): value is TrialExtensionDays {
  return typeof value === "number" && (TRIAL_EXTENSION_DAYS as readonly number[]).includes(value)
}

export type TrialExtensionBlocker =
  "conta_fora_do_teste" | "teste_controlado_pela_stripe" | "limite_de_prorrogacao"

export type TrialExtensionInput = {
  status: string | null | undefined
  planKey: string | null | undefined
  hasSubscription: boolean
  trialEndsAt: string | null | undefined
}

/** Fim do teste depois de prorrogar: conta do fim atual ou de agora, o que for maior. */
export function extendedTrialEnd(
  trialEndsAt: string | null | undefined,
  days: TrialExtensionDays,
  now: Date
): Date {
  const current = trialEndsAt ? Date.parse(trialEndsAt) : Number.NaN
  const base = Number.isFinite(current) ? Math.max(current, now.getTime()) : now.getTime()
  return new Date(base + days * DAY_MS)
}

/**
 * Por que o teste não pode ser prorrogado em `days` (null = pode). Só o teste
 * grátis local (status trialing, plano trial, sem assinatura na Stripe): o
 * teste criado na Stripe é da Stripe e não é mexido pelo console.
 */
export function trialExtensionBlocker(
  input: TrialExtensionInput,
  days: TrialExtensionDays,
  now: Date
): TrialExtensionBlocker | null {
  if (input.status !== "trialing") {
    return "conta_fora_do_teste"
  }

  if (input.planKey !== "trial" || input.hasSubscription) {
    return "teste_controlado_pela_stripe"
  }

  const limit = now.getTime() + TRIAL_EXTENSION_MAX_AHEAD_DAYS * DAY_MS

  return extendedTrialEnd(input.trialEndsAt, days, now).getTime() > limit
    ? "limite_de_prorrogacao"
    : null
}

/**
 * Respostas estáveis das RPCs de ação (mensagem do erro P0001/22023) em pt-BR.
 * Qualquer outro texto do banco não vai para a tela.
 */
export const PLATFORM_ACCOUNT_ACTION_ERRORS = {
  motivo_obrigatorio: "Escreva o motivo (de 3 a 1.000 caracteres).",
  dias_invalidos: "Escolha prorrogar por 7 ou 14 dias.",
  conta_ja_bloqueada: "Esta conta já está bloqueada.",
  conta_nao_bloqueada: "Esta conta não está bloqueada.",
  conta_fora_do_teste: "Só dá para prorrogar o teste de quem ainda está em teste grátis.",
  teste_controlado_pela_stripe:
    "Este teste foi criado na Stripe (há assinatura vinculada): prorrogue pelo painel da Stripe.",
  limite_de_prorrogacao: `O teste não pode terminar mais de ${TRIAL_EXTENSION_MAX_AHEAD_DAYS} dias à frente de hoje.`,
} as const

export type PlatformAccountActionErrorCode = keyof typeof PLATFORM_ACCOUNT_ACTION_ERRORS

export function isPlatformAccountActionErrorCode(
  value: unknown
): value is PlatformAccountActionErrorCode {
  return typeof value === "string" && Object.hasOwn(PLATFORM_ACCOUNT_ACTION_ERRORS, value)
}

// ---------------------------------------------------------------------------
// Filtros da lista (URL)
// ---------------------------------------------------------------------------

export const PLATFORM_ORGANIZATIONS_PATH = "/plataforma/imobiliarias"
export const PLATFORM_ORGANIZATIONS_PAGE_SIZE = 25
export const PLATFORM_ORGANIZATION_SEARCH_MAX_LENGTH = 100

export type OrganizationListFilters = {
  busca: string
  situacao: "" | AccountSituation
  plano: "" | BillingPlanKey
  pagina: number
}

type RawSearchParams = Record<string, string | string[] | undefined>

function first(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? ""
}

/** Busca: espaços repetidos viram um só, sem as pontas, até 100 caracteres. */
export function sanitizeOrganizationSearch(value: string): string {
  return value.replace(/\s+/g, " ").trim().slice(0, PLATFORM_ORGANIZATION_SEARCH_MAX_LENGTH)
}

export function parseOrganizationListFilters(params: RawSearchParams): OrganizationListFilters {
  const situacao = first(params.situacao)
  const plano = first(params.plano)
  const pagina = Number.parseInt(first(params.pagina), 10)

  return {
    busca: sanitizeOrganizationSearch(first(params.busca)),
    situacao: isAccountSituation(situacao) ? situacao : "",
    plano: isPlatformPlanKey(plano) ? plano : "",
    pagina: Number.isFinite(pagina) && pagina > 0 ? Math.min(pagina, 4_000) : 1,
  }
}

export function hasActiveOrganizationFilters(filters: OrganizationListFilters): boolean {
  return Boolean(filters.busca || filters.situacao || filters.plano)
}

/** URL da lista com os filtros (página 1 e valores vazios são omitidos). */
export function buildOrganizationListHref(filters: Partial<OrganizationListFilters>): string {
  const params = new URLSearchParams()

  if (filters.busca) params.set("busca", filters.busca)
  if (filters.situacao) params.set("situacao", filters.situacao)
  if (filters.plano) params.set("plano", filters.plano)
  if (filters.pagina && filters.pagina > 1) params.set("pagina", String(filters.pagina))

  const query = params.toString()
  return query ? `${PLATFORM_ORGANIZATIONS_PATH}?${query}` : PLATFORM_ORGANIZATIONS_PATH
}

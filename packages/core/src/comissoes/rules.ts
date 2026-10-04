// Tabela de comissão: papéis, base de cálculo e regra padrão.
//
// Todo o dinheiro deste módulo é inteiro, em CENTAVOS. Nunca use float para
// valor: `numeric` no banco, `number` inteiro (centavos) aqui, `formatBRL` só
// na borda de exibição.
//
// Percentuais são guardados em MILÉSIMOS de ponto percentual (milli-percent):
// 6% = 6000, 33,333% = 33333. Assim a soma de um rateio é comparada com
// inteiros (100% = 100000) e nunca depende de 0.1 + 0.2 === 0.30000000000000004.

/** Tipo de negócio que a tabela de comissão distingue. */
export const COMMISSION_PURPOSES = ["sale", "rent"] as const

export type CommissionPurpose = (typeof COMMISSION_PURPOSES)[number]

export const COMMISSION_PURPOSE_LABELS: Record<CommissionPurpose, string> = {
  sale: "Venda",
  rent: "Locação",
}

/** Como a comissão sai do valor do negócio. */
export const COMMISSION_BASES = ["percent", "fixed"] as const

export type CommissionBasis = (typeof COMMISSION_BASES)[number]

export const COMMISSION_BASIS_LABELS: Record<CommissionBasis, string> = {
  percent: "Percentual do negócio",
  fixed: "Valor fixo",
}

/**
 * Papéis que dividem a comissão. A ordem é a do extrato e também a ordem de
 * desempate do arredondamento (ver `splitCommission`).
 */
export const COMMISSION_ROLES = ["capturer", "seller", "manager", "agency", "partner"] as const

export type CommissionRole = (typeof COMMISSION_ROLES)[number]

export const COMMISSION_ROLE_LABELS: Record<CommissionRole, string> = {
  capturer: "Captação",
  seller: "Atendimento",
  manager: "Gerência",
  agency: "Imobiliária",
  partner: "Parceiro externo",
}

export const COMMISSION_ROLE_DESCRIPTIONS: Record<CommissionRole, string> = {
  capturer: "Quem captou o imóvel.",
  seller: "Quem atendeu o cliente e fechou o negócio.",
  manager: "O gerente responsável pela equipe.",
  agency: "A imobiliária. Também fica com a sobra de centavos do rateio.",
  partner: "Imobiliária ou corretor parceiro de fora, quando houver.",
}

/** Papéis pagos a uma pessoa da equipe (entram no extrato individual). */
export const COMMISSION_MEMBER_ROLES: readonly CommissionRole[] = ["capturer", "seller", "manager"]

/** Situação de uma comissão registrada. */
export const COMMISSION_STATUSES = ["pending", "partially_paid", "paid", "canceled"] as const

export type CommissionStatus = (typeof COMMISSION_STATUSES)[number]

export const COMMISSION_STATUS_LABELS: Record<CommissionStatus, string> = {
  pending: "A receber",
  partially_paid: "Parcialmente paga",
  paid: "Paga",
  canceled: "Cancelada",
}

/** Situação de um pedido de aprovação de desconto. */
export const DISCOUNT_REQUEST_STATUSES = ["pending", "approved", "rejected"] as const

export type DiscountRequestStatus = (typeof DISCOUNT_REQUEST_STATUSES)[number]

export const DISCOUNT_REQUEST_STATUS_LABELS: Record<DiscountRequestStatus, string> = {
  pending: "Aguardando o gerente",
  approved: "Aprovado",
  rejected: "Recusado",
}

// ---------------------------------------------------------------------------
// Percentuais em milésimos
// ---------------------------------------------------------------------------

/** 1 ponto percentual = 1000 milésimos. */
export const PERCENT_SCALE = 1000

/** 100% em milésimos. É exatamente isso que um rateio precisa somar. */
export const FULL_PERCENT = 100 * PERCENT_SCALE

/** Percentual (6,5) → milésimos (6500). Arredonda na terceira casa. */
export function toMilliPercent(percent: number): number {
  if (!Number.isFinite(percent)) {
    return 0
  }

  return Math.round(percent * PERCENT_SCALE)
}

/** Milésimos (6500) → percentual (6.5). */
export function fromMilliPercent(milli: number): number {
  if (!Number.isFinite(milli)) {
    return 0
  }

  return Math.round(milli) / PERCENT_SCALE
}

/** "6,5%" — até 3 casas, sem zeros à direita. */
export function formatPercent(percent: number): string {
  const safe = Number.isFinite(percent) ? percent : 0

  return `${new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 3 }).format(safe)}%`
}

// ---------------------------------------------------------------------------
// Regra de comissão
// ---------------------------------------------------------------------------

/** Percentuais do rateio, por papel. Precisam somar exatamente 100%. */
export type CommissionSplit = Record<CommissionRole, number>

export type CommissionRule = {
  purpose: CommissionPurpose
  basis: CommissionBasis
  /** Usado quando `basis` é "percent". */
  percent: number
  /** Usado quando `basis` é "fixed". Centavos inteiros. */
  fixedCents: number
  split: CommissionSplit
}

/**
 * Regra usada quando a imobiliária ainda não configurou a tabela: 6% na venda
 * (praxe do mercado urbano) e 100% do primeiro aluguel na locação.
 */
export const DEFAULT_COMMISSION_SPLIT: CommissionSplit = {
  capturer: 20,
  seller: 30,
  manager: 10,
  agency: 40,
  partner: 0,
}

export const DEFAULT_COMMISSION_RULES: Record<CommissionPurpose, CommissionRule> = {
  sale: {
    purpose: "sale",
    basis: "percent",
    percent: 6,
    fixedCents: 0,
    split: { ...DEFAULT_COMMISSION_SPLIT },
  },
  rent: {
    purpose: "rent",
    basis: "percent",
    percent: 100,
    fixedCents: 0,
    split: { ...DEFAULT_COMMISSION_SPLIT },
  },
}

/** Soma do rateio em milésimos (100000 quando fecha 100%). */
export function splitTotalMilli(split: CommissionSplit): number {
  return COMMISSION_ROLES.reduce((total, role) => total + toMilliPercent(split[role]), 0)
}

/** Verdadeiro só quando o rateio fecha exatamente 100%. */
export function isSplitBalanced(split: CommissionSplit): boolean {
  return splitTotalMilli(split) === FULL_PERCENT
}

/**
 * Mensagem pronta para o formulário quando o rateio não fecha. `null` quando
 * está certo. Espelha a mensagem do gatilho do banco.
 */
export function describeSplitImbalance(split: CommissionSplit): string | null {
  const total = splitTotalMilli(split)

  if (total === FULL_PERCENT) {
    return null
  }

  const difference = fromMilliPercent(Math.abs(total - FULL_PERCENT))

  return total > FULL_PERCENT
    ? `A divisão soma ${formatPercent(fromMilliPercent(total))}: tire ${formatPercent(difference)}.`
    : `A divisão soma ${formatPercent(fromMilliPercent(total))}: faltam ${formatPercent(difference)}.`
}

/**
 * Valor total da comissão, em centavos inteiros.
 *
 * - `percent`: `base × percentual`, arredondado meio para cima no centavo.
 * - `fixed`: o valor fixo, limitado ao valor do negócio (a comissão nunca é
 *   maior que o que foi vendido/alugado).
 *
 * A multiplicação usa BigInt: `numeric(14,2)` chega a 1e14 centavos e o produto
 * por 1e5 milésimos estoura o inteiro seguro de um `number`.
 */
export function commissionTotalCents(rule: CommissionRule, baseCents: number): number {
  const base = safeCents(baseCents)

  if (base <= 0) {
    return 0
  }

  if (rule.basis === "fixed") {
    return Math.min(safeCents(rule.fixedCents), base)
  }

  const milli = toMilliPercent(rule.percent)

  if (milli <= 0) {
    return 0
  }

  return Number(divideRoundHalfUp(BigInt(base) * BigInt(milli), BigInt(FULL_PERCENT)))
}

/** Divisão inteira arredondando meio para cima (só para numerador ≥ 0). */
export function divideRoundHalfUp(numerator: bigint, denominator: bigint): bigint {
  return (numerator * 2n + denominator) / (denominator * 2n)
}

/** Centavos vindos da borda (banco, formulário) como inteiro não negativo. */
export function safeCents(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0
}

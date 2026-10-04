// Divisão (split) da comissão entre os papéis do negócio, em centavos inteiros.
//
// REGRA DE ARREDONDAMENTO (a mesma do gatilho `private.commission_split` no
// banco; qualquer mudança aqui precisa mudar lá e nos dois testes):
//
//   1. Papel sem pessoa (não houve captador, gerente ou parceiro) tem o
//      percentual dele REDIRECIONADO PARA A IMOBILIÁRIA. Ninguém recebe por um
//      papel que não exerceu e nenhum centavo fica órfão.
//   2. Cada papel que não é a imobiliária recebe
//      `arredonda_meio_para_cima(total × percentual)`.
//   3. A IMOBILIÁRIA FICA COM A SOBRA: a parte dela é
//      `total − soma(demais)`, nunca o próprio percentual arredondado. É isso
//      que faz a divisão fechar o centavo exato em qualquer valor
//      (R$ 10.000,01 dividido por três fecha em R$ 10.000,01).
//   4. Se o arredondamento do passo 2 passar do total (só acontece quando a
//      imobiliária tem 0%), a diferença é descontada da MAIOR parte; empate
//      resolve pela ordem inversa de COMMISSION_ROLES (parceiro perde antes do
//      gerente, que perde antes do atendimento, que perde antes da captação).
//
// A soma das partes é sempre exatamente o total. O teste
// `split.test.ts` prova isso por varredura.

import {
  COMMISSION_ROLES,
  divideRoundHalfUp,
  FULL_PERCENT,
  fromMilliPercent,
  safeCents,
  toMilliPercent,
  type CommissionRole,
  type CommissionSplit,
} from "./rules"

/** Quem ocupou cada papel no negócio. `null` = ninguém (cai para a imobiliária). */
export type CommissionParticipants = {
  /** Usuário que captou o imóvel. */
  capturer: string | null
  /** Usuário que atendeu o cliente (corretor da proposta). */
  seller: string | null
  /** Usuário do gerente que recebe a fatia de gerência. */
  manager: string | null
  /** Nome do parceiro externo, quando houver. */
  partner: string | null
}

export type CommissionShare = {
  role: CommissionRole
  /** Percentual efetivo da parte (já com o redirecionamento do passo 1). */
  percent: number
  amountCents: number
  /** Usuário dono da parte; `null` na imobiliária e no parceiro externo. */
  userId: string | null
  /** Nome do parceiro externo; `null` nos demais papéis. */
  partnerName: string | null
}

export const NO_PARTICIPANTS: CommissionParticipants = {
  capturer: null,
  seller: null,
  manager: null,
  partner: null,
}

/** Papéis que precisam de uma pessoa para receber. A imobiliária nunca falta. */
const ASSIGNABLE_ROLES: readonly CommissionRole[] = ["capturer", "seller", "manager", "partner"]

function participantOf(role: CommissionRole, participants: CommissionParticipants): string | null {
  switch (role) {
    case "capturer":
      return participants.capturer
    case "seller":
      return participants.seller
    case "manager":
      return participants.manager
    case "partner":
      return participants.partner
    default:
      return null
  }
}

/**
 * Percentuais efetivos em milésimos: o que cada papel realmente recebe depois
 * de jogar na imobiliária o percentual dos papéis sem pessoa (passo 1).
 */
export function effectiveSplitMilli(
  split: CommissionSplit,
  participants: CommissionParticipants
): Record<CommissionRole, number> {
  const effective = {} as Record<CommissionRole, number>
  let toAgency = 0

  for (const role of COMMISSION_ROLES) {
    const milli = Math.max(0, toMilliPercent(split[role]))

    if (role === "agency") {
      effective.agency = milli
      continue
    }

    if (participantOf(role, participants) === null) {
      effective[role] = 0
      toAgency += milli
      continue
    }

    effective[role] = milli
  }

  effective.agency += toAgency

  return effective
}

/**
 * Divide `totalCents` entre os papéis. Devolve uma parte por papel com valor ou
 * pessoa: a imobiliária sempre entra (é ela quem fecha a conta).
 *
 * A soma de `amountCents` é sempre igual a `totalCents`.
 */
export function splitCommission(
  totalCents: number,
  split: CommissionSplit,
  participants: CommissionParticipants = NO_PARTICIPANTS
): CommissionShare[] {
  const total = safeCents(totalCents)
  const effective = effectiveSplitMilli(split, participants)
  const amounts = {} as Record<CommissionRole, number>

  let distributed = 0

  // Passos 2 e 3: todo mundo arredonda; a imobiliária recebe o que sobrar.
  for (const role of COMMISSION_ROLES) {
    if (role === "agency") {
      continue
    }

    const amount =
      effective[role] > 0
        ? Number(divideRoundHalfUp(BigInt(total) * BigInt(effective[role]), BigInt(FULL_PERCENT)))
        : 0

    amounts[role] = amount
    distributed += amount
  }

  amounts.agency = total - distributed

  // Passo 4: o arredondamento passou do total (a imobiliária ficaria negativa).
  if (amounts.agency < 0) {
    amounts.agency = takeDeficitFromLargest(amounts, -amounts.agency)
  }

  const shares: CommissionShare[] = []

  for (const role of COMMISSION_ROLES) {
    const isAgency = role === "agency"
    const participant = participantOf(role, participants)

    // Papel com 0% efetivo não vira linha: ou não tinha percentual na regra, ou
    // não teve pessoa e o percentual já foi para a imobiliária.
    if (!isAgency && effective[role] === 0) {
      continue
    }

    shares.push({
      role,
      percent: fromMilliPercent(effective[role]),
      amountCents: amounts[role],
      userId: isAgency || role === "partner" ? null : participant,
      partnerName: role === "partner" ? participant : null,
    })
  }

  return shares
}

/**
 * Tira `deficit` centavos das maiores partes (empate: ordem inversa dos papéis)
 * até a imobiliária voltar a zero. Devolve a nova parte da imobiliária (0).
 */
function takeDeficitFromLargest(amounts: Record<CommissionRole, number>, deficit: number): number {
  const order = ASSIGNABLE_ROLES.slice().reverse()
  let remaining = deficit

  while (remaining > 0) {
    let target: CommissionRole | null = null

    for (const role of order) {
      if (amounts[role] > 0 && (target === null || amounts[role] > amounts[target])) {
        target = role
      }
    }

    // Só acontece se o total for 0 e alguém tiver valor negativo: impossível
    // (os valores vêm de uma divisão de um total não negativo).
    if (target === null) {
      return -remaining
    }

    const taken = Math.min(remaining, amounts[target])
    amounts[target] -= taken
    remaining -= taken
  }

  return 0
}

/** Soma das partes. Usada nos testes e na conferência antes de gravar. */
export function totalOfShares(shares: readonly CommissionShare[]): number {
  return shares.reduce((total, share) => total + share.amountCents, 0)
}

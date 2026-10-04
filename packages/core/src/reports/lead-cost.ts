/**
 * Custo por lead e custo por ganho (aba "Origem do lead").
 *
 * O investimento de cada linha vem pronto do banco (`report_lead_sources`):
 * proporcional aos dias do período e dividido entre as linhas pela quantidade
 * de leads. Ele só existe na visão da imobiliária inteira de dono e gerente;
 * com filtro de corretor ou equipe a RPC devolve `null` — o gasto não é
 * dividido por equipe, e recortado inflaria o custo.
 *
 * Regras daqui:
 * - sem investimento (`null`) não há custo: "—", nunca R$ 0,00;
 * - investimento zero também não vira custo por lead de R$ 0,00 (seria ler
 *   "canal grátis" onde só faltou lançar o gasto);
 * - divisão por zero leads ou zero ganhos devolve `null`.
 */

export type LeadCostInput = {
  investment: number | null
  leads: number
  won: number
}

export type LeadCost = {
  investment: number | null
  /** Investimento ÷ leads. */
  costPerLead: number | null
  /** Investimento ÷ ganhos. */
  costPerWin: number | null
}

function cents(value: number) {
  return Math.round(value * 100) / 100
}

function divide(amount: number | null, count: number): number | null {
  if (amount === null || !Number.isFinite(amount) || amount <= 0) {
    return null
  }

  if (!Number.isFinite(count) || count <= 0) {
    return null
  }

  return cents(amount / count)
}

export function leadCost({ investment, leads, won }: LeadCostInput): LeadCost {
  const normalized = investment === null || !Number.isFinite(investment) ? null : investment

  return {
    investment: normalized,
    costPerLead: divide(normalized, leads),
    costPerWin: divide(normalized, won),
  }
}

/**
 * Investimento somado das linhas. `null` quando nenhuma linha trouxe
 * investimento (relatório recortado ou papel sem acesso ao gasto).
 */
export function sumInvestment(rows: readonly { investment: number | null }[]): number | null {
  let total: number | null = null

  for (const row of rows) {
    if (row.investment !== null && Number.isFinite(row.investment)) {
      total = (total ?? 0) + row.investment
    }
  }

  return total === null ? null : cents(total)
}

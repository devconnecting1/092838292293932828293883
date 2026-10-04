// Formatação de valores da assinatura para a UI (pt-BR). Todo o módulo trabalha
// em CENTAVOS; só a borda de exibição converte para reais.

const BRL_WITH_CENTS = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

const BRL_WITHOUT_CENTS = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
})

const INTEGER = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 })

export type FormatBRLOptions = {
  /** Omite ",00" quando o valor é inteiro em reais (ex.: "R$ 89" nos cartões de preço). */
  omitZeroCents?: boolean
}

/**
 * Centavos → "R$ 1.490,00".
 * - Arredonda para o centavo inteiro; valor não finito vira zero (nunca lança na UI).
 * - O Intl separa "R$" do número com espaço não separável, que varia com a versão
 *   do ICU. A saída usa espaço comum, estável em testes, e-mails e textos.
 */
export function formatBRL(cents: number, options: FormatBRLOptions = {}): string {
  // `|| 0` também elimina o -0, que o Intl exibiria como "-R$ 0,00".
  const safeCents = Number.isFinite(cents) ? Math.round(cents) || 0 : 0
  const formatter =
    options.omitZeroCents && safeCents % 100 === 0 ? BRL_WITHOUT_CENTS : BRL_WITH_CENTS

  return formatter.format(safeCents / 100).replace(/\s/g, " ")
}

/**
 * Valor de limite para exibição, pela convenção do catálogo:
 * negativo (-1) = "Ilimitado"; 0 = "Não incluso"; demais = número pt-BR com unidade opcional.
 */
export function formatLimit(limit: number, unit?: string): string {
  if (!Number.isFinite(limit)) {
    return "—"
  }

  if (limit < 0) {
    return "Ilimitado"
  }

  if (limit === 0) {
    return "Não incluso"
  }

  const value = INTEGER.format(limit).replace(/\s/g, " ")
  return unit ? `${value} ${unit}` : value
}

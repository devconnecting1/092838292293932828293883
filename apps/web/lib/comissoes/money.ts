// Máscara de dinheiro para os campos de comissão. Tudo aqui é CENTAVO INTEIRO:
// o formulário digita centavos, a Server Action manda centavos e o banco guarda
// bigint. Só a exibição (formatBRL, no core) converte para reais.

/** 14 dígitos de centavos = até 999.999.999.999,99 (teto de numeric(14,2)). */
const MAX_CENTS_DIGITS = 14

const brlInput = new Intl.NumberFormat("pt-BR", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

/** Máscara progressiva: os dígitos digitados viram centavos ("123456" → "1.234,56"). */
export function maskBrlInput(value: string) {
  const digits = value.replace(/\D/g, "").replace(/^0+/, "").slice(0, MAX_CENTS_DIGITS)

  if (!digits) {
    return ""
  }

  return brlInput.format(Number(digits) / 100)
}

/** Lê um valor mascarado ("1.234,56") como CENTAVOS inteiros (123456). Vazio → null. */
export function parseBrlCents(value: string) {
  const digits = value.replace(/\D/g, "").slice(0, MAX_CENTS_DIGITS)

  if (!digits) {
    return null
  }

  const cents = Number(digits)
  return Number.isSafeInteger(cents) ? cents : null
}

/** Centavos do banco → texto do campo mascarado. */
export function centsToBrlInput(cents: number | null | undefined) {
  return cents == null ? "" : brlInput.format(cents / 100)
}

/** Percentual digitado ("6,5") → número (6.5). Vazio ou inválido → null. */
export function parsePercentInput(value: string) {
  const normalized = value.replace(/\s/g, "").replace(",", ".")

  if (normalized === "") {
    return null
  }

  const parsed = Number(normalized)
  return Number.isFinite(parsed) ? parsed : null
}

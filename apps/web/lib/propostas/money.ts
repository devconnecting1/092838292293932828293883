// Máscara de valores em reais para campos de formulário.

/** 14 dígitos de centavos = até 999.999.999.999,99 (numeric(14,2) no banco). */
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

/** Lê um valor mascarado ("1.234,56") como número (1234.56). Vazio → null. */
export function parseBrlInput(value: string) {
  const digits = value.replace(/\D/g, "").slice(0, MAX_CENTS_DIGITS)

  if (!digits) {
    return null
  }

  const amount = Number(digits) / 100
  return Number.isFinite(amount) ? amount : null
}

/** Valor do banco → texto do campo mascarado. */
export function amountToBrlInput(amount: number | null | undefined) {
  return amount == null ? "" : brlInput.format(amount)
}

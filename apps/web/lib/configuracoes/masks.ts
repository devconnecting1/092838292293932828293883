// Máscaras de digitação (aceitam valores incompletos). A validação fica em @workspace/core.

/** CNPJ numérico ou alfanumérico: 00.000.000/0000-00 ou 12.ABC.345/01DE-35. */
export function maskCnpj(value: string) {
  const cnpj = value
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, "")
    .slice(0, 14)
  let formatted = cnpj.slice(0, 2)

  if (cnpj.length > 2) formatted += `.${cnpj.slice(2, 5)}`
  if (cnpj.length > 5) formatted += `.${cnpj.slice(5, 8)}`
  if (cnpj.length > 8) formatted += `/${cnpj.slice(8, 12)}`
  if (cnpj.length > 12) formatted += `-${cnpj.slice(12, 14)}`

  return formatted
}

/** Telefone com DDD: (19) 3333-4444 ou (19) 99999-8888. */
export function maskPhoneBr(value: string) {
  const digits = value.replace(/\D/g, "").slice(0, 11)

  if (digits.length === 0) return ""
  if (digits.length <= 2) return `(${digits}`

  const ddd = digits.slice(0, 2)
  const subscriber = digits.slice(2)

  if (subscriber.length <= 4) return `(${ddd}) ${subscriber}`

  const splitAt = subscriber.length === 9 ? 5 : 4
  return `(${ddd}) ${subscriber.slice(0, splitAt)}-${subscriber.slice(splitAt)}`
}

// Máscaras progressivas (enquanto digita) e links de contato.
// A validação fica em @workspace/core/br/documents.
import { formatPhoneBr, isValidPhoneBr } from "@workspace/core/br/documents"

export function maskPhoneInput(value: string) {
  let digits = value.replace(/\D/g, "")

  if (digits.length > 11 && digits.startsWith("55")) {
    digits = digits.slice(2)
  }

  digits = digits.slice(0, 11)

  if (!digits) return ""
  if (digits.length <= 2) return `(${digits}`

  const ddd = digits.slice(0, 2)
  const rest = digits.slice(2)

  if (rest.length <= 4) return `(${ddd}) ${rest}`
  if (digits.length === 11) return `(${ddd}) ${rest.slice(0, 5)}-${rest.slice(5)}`

  return `(${ddd}) ${rest.slice(0, 4)}-${rest.slice(4)}`
}

export function maskPostalCodeInput(value: string) {
  const digits = value.replace(/\D/g, "").slice(0, 8)
  return digits.length > 5 ? `${digits.slice(0, 5)}-${digits.slice(5)}` : digits
}

/** Telefone salvo só com dígitos → "(11) 98765-4321". */
export function formatPhoneDisplay(value: string | null | undefined) {
  if (!value) return null

  return isValidPhoneBr(value) ? formatPhoneBr(value) : maskPhoneInput(value)
}

/** Link do WhatsApp (wa.me) para um telefone brasileiro salvo só com dígitos. */
export function whatsappUrl(value: string | null | undefined) {
  const digits = (value ?? "").replace(/\D/g, "")

  if (digits.length === 10 || digits.length === 11) {
    return `https://wa.me/55${digits}`
  }

  if ((digits.length === 12 || digits.length === 13) && digits.startsWith("55")) {
    return `https://wa.me/${digits}`
  }

  return null
}

export function telUrl(value: string | null | undefined) {
  const digits = (value ?? "").replace(/\D/g, "")
  return digits.length >= 10 ? `tel:+55${digits.length > 11 ? digits.slice(2) : digits}` : null
}

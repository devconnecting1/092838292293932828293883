import { whatsappHref } from "@/lib/portal/config"

/** Link do grupo de WhatsApp das cotas; sem ele, o botão abre o atendimento. */
export function grupoCotasHref() {
  const url = process.env.NEXT_PUBLIC_COTAS_GRUPO_URL ?? ""
  return /^https:\/\/chat\.whatsapp\.com\/[A-Za-z0-9]+$/.test(url)
    ? url
    : whatsappHref("Olá! Quero entrar no grupo de arremate em cotas.")
}

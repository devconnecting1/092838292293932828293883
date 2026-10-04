// Campos do payload público que o módulo de Landing Pages (lib/landing) está
// acrescentando: content.whatsapp_message. Lido de forma tolerante para
// compilar antes e depois de entrar nos tipos. (tracking.gtm_container_id segue
// salvo, mas a página pública não o lê: o GTM não é carregado, ver LandingTracking.)

import type { LandingPublicPayload } from "@/lib/landing/types"

const WHATSAPP_MESSAGE_MAX_LENGTH = 500
const WHATSAPP_TEXT_MAX_LENGTH = 1000

const DEFAULT_MESSAGE_WITH_CODE =
  'Olá! Vim pela página "{pagina}" e tenho interesse no imóvel {codigo}.'
const DEFAULT_MESSAGE_WITHOUT_CODE = 'Olá! Vim pela página "{pagina}" e gostaria de atendimento.'

/** content.whatsapp_message (aceita {codigo} e {pagina}); null quando vazio. */
export function readWhatsappMessageTemplate(payload: LandingPublicPayload): string | null {
  const content: Record<string, unknown> = payload.page.content
  const value = content.whatsapp_message

  if (typeof value !== "string") return null

  const message = value.replace(/\s+/g, " ").trim()

  return message ? Array.from(message).slice(0, WHATSAPP_MESSAGE_MAX_LENGTH).join("") : null
}

/**
 * Mensagem pré-preenchida do WhatsApp. Troca {codigo} pelo código do imóvel e
 * {pagina} pelo título da página. Nunca inclui dados do visitante.
 */
export function fillWhatsappMessage(
  template: string | null | undefined,
  values: { codigo: string | null; pagina: string }
) {
  const base =
    template?.trim() || (values.codigo ? DEFAULT_MESSAGE_WITH_CODE : DEFAULT_MESSAGE_WITHOUT_CODE)

  return base
    .replace(/\{codigo\}/gi, values.codigo ?? "")
    .replace(/\{pagina\}/gi, values.pagina)
    .replace(/\(\s*\)/g, "")
    .replace(/\s+([.,!?;:])/g, "$1")
    .replace(/\s{2,}/g, " ")
    .trim()
    .slice(0, WHATSAPP_TEXT_MAX_LENGTH)
}

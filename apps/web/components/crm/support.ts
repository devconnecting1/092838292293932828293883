import { APP_NAME } from "@/components/crm/brand"

/**
 * Contato do suporte humano, lido de variáveis públicas (inlinadas no build):
 * - NEXT_PUBLIC_SUPPORT_WHATSAPP: número com DDI e DDD (só os dígitos contam);
 * - NEXT_PUBLIC_SUPPORT_EMAIL: usado só quando não há WhatsApp.
 * Sem nenhum dos dois, o botão "Ajuda" não aparece.
 *
 * As referências precisam ser literais (process.env.NEXT_PUBLIC_...) para o
 * Next.js inlinar os valores no navegador.
 */
const SUPPORT_WHATSAPP = process.env.NEXT_PUBLIC_SUPPORT_WHATSAPP?.trim() ?? ""
const SUPPORT_EMAIL = process.env.NEXT_PUBLIC_SUPPORT_EMAIL?.trim() ?? ""

const UUID_SEGMENT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const EMAIL_PATTERN = /^[^\s@<>()[\],;:"]+@[^\s@<>()[\],;:"]+\.[^\s@<>()[\],;:"]+$/

export type SupportContact = {
  channel: "whatsapp" | "email"
  href: string
}

export type SupportContext = {
  /** Origem do site (ex.: https://imob.seucrm.com.br); vazia no servidor. */
  origin?: string
  /** Caminho atual, sem query string. */
  pathname?: string | null
  /** Código do erro (digest do Next.js), na página de erro. */
  errorCode?: string | null
}

/**
 * Número no formato do wa.me: só dígitos, com DDI. Número brasileiro salvo sem
 * o 55 (10 ou 11 dígitos) ganha o DDI. Fora de 12 a 15 dígitos, é inválido.
 * Formato: https://faq.whatsapp.com/general/chats/how-to-use-click-to-chat
 */
export function normalizeSupportWhatsapp(value: string) {
  const digits = value.replace(/\D/g, "")
  const withCountry = digits.length === 10 || digits.length === 11 ? `55${digits}` : digits

  return withCountry.length >= 12 && withCountry.length <= 15 ? withCountry : null
}

/**
 * Caminho sem ids (vira "[id]"): o suporte sabe qual tela era sem receber o
 * identificador de cliente, lead ou imóvel. A query string nunca entra, porque
 * pode trazer busca por nome ou telefone.
 */
export function describeSupportPage(pathname: string | null | undefined) {
  if (!pathname) return null

  const clean = (pathname.split(/[?#]/, 1)[0] ?? "")
    .split("/")
    .map((segment) => (UUID_SEGMENT.test(segment) ? "[id]" : segment))
    .join("/")
    .slice(0, 200)

  return clean || "/"
}

export function buildSupportMessage({ origin, pathname, errorCode }: SupportContext) {
  const page = describeSupportPage(pathname)
  const lines = [`Olá! Preciso de ajuda no ${APP_NAME}.`]

  if (page) {
    lines.push(`Página: ${origin ? `${origin}${page}` : page}`)
  }

  if (errorCode) {
    lines.push(`Código do erro: ${errorCode.slice(0, 64)}`)
  }

  return lines.join("\n")
}

/** Se há algum contato de suporte configurado (WhatsApp ou e-mail). */
export function hasSupportContact() {
  return getSupportContact({}) !== null
}

/** Link do suporte: WhatsApp com mensagem pronta, e-mail como alternativa, ou null. */
export function getSupportContact(context: SupportContext): SupportContact | null {
  const message = buildSupportMessage(context)
  const whatsapp = normalizeSupportWhatsapp(SUPPORT_WHATSAPP)

  if (whatsapp) {
    return {
      channel: "whatsapp",
      href: `https://wa.me/${whatsapp}?text=${encodeURIComponent(message)}`,
    }
  }

  if (EMAIL_PATTERN.test(SUPPORT_EMAIL)) {
    const subject = context.errorCode ? "Ajuda: erro no CRM" : "Ajuda no CRM"

    return {
      channel: "email",
      href: `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(message)}`,
    }
  }

  return null
}

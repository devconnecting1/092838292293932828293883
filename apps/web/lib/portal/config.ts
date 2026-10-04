/**
 * Configuração do portal público (marca branca).
 *
 * O layout é o mesmo para todos; a marca, a cor e os contatos vêm das variáveis
 * de ambiente, com os padrões do Vamos Arrematar. Trocar a cor = trocar
 * NEXT_PUBLIC_BRAND_PRIMARY (hex de 6 dígitos), sem mexer em código.
 */

const HEX = /^#[0-9a-fA-F]{6}$/
const GTM = /^GTM-[A-Z0-9]{4,12}$/

function env(name: string) {
  return process.env[name]?.trim() ?? ""
}

function pickHex(value: string, fallback: string) {
  return HEX.test(value) ? value : fallback
}

export const PORTAL = {
  name: env("NEXT_PUBLIC_BRAND_NAME") || "Vamos Arrematar",
  legalName: env("NEXT_PUBLIC_BRAND_LEGAL_NAME") || "FDS Corretagem de Imóveis Ltda.",
  cnpj: env("NEXT_PUBLIC_BRAND_CNPJ") || "41.485.670/0001-22",
  creci: env("NEXT_PUBLIC_BRAND_CRECI") || "CRECI-RJ 073649",
  address:
    env("NEXT_PUBLIC_BRAND_ADDRESS") ||
    "Av. das Américas, 4.200, bloco 01, sala 305, Barra da Tijuca, Rio de Janeiro/RJ",
  whatsapp: (env("NEXT_PUBLIC_SUPPORT_WHATSAPP") || "08005431000").replace(/\D/g, ""),
  whatsappLabel: env("NEXT_PUBLIC_SUPPORT_WHATSAPP_LABEL") || "0800 543 1000",
  email: env("NEXT_PUBLIC_SUPPORT_EMAIL") || "",
  primary: pickHex(env("NEXT_PUBLIC_BRAND_PRIMARY"), "#1F4FD1"),
  logoUrl: env("NEXT_PUBLIC_BRAND_LOGO_URL"),
  gtmId: GTM.test(env("NEXT_PUBLIC_GTM_ID") || "GTM-T7K5RDWW")
    ? env("NEXT_PUBLIC_GTM_ID") || "GTM-T7K5RDWW"
    : "",
} as const

export function whatsappHref(message?: string) {
  const digits = PORTAL.whatsapp
  // 0800 não abre conversa no wa.me; nesse caso o botão liga para o número.
  if (digits.startsWith("0800")) {
    return `tel:${digits}`
  }
  const text = message ? `?text=${encodeURIComponent(message)}` : ""
  return `https://wa.me/${digits.startsWith("55") ? digits : `55${digits}`}${text}`
}

/** Mistura a cor com branco (amt > 0) ou preto (amt < 0). */
export function mixColor(hex: string, amt: number) {
  const n = Number.parseInt(hex.slice(1), 16)
  const r = (n >> 16) & 255
  const g = (n >> 8) & 255
  const b = n & 255
  const target = amt > 0 ? 255 : 0
  const a = Math.abs(amt)
  const f = (c: number) => Math.round(c + (target - c) * a)
  return `rgb(${f(r)} ${f(g)} ${f(b)})`
}

export function brandCssVars(): React.CSSProperties {
  const p = PORTAL.primary
  return {
    ["--brand" as string]: p,
    ["--brand-soft" as string]: mixColor(p, 0.92),
    ["--brand-mid" as string]: mixColor(p, 0.78),
    ["--brand-deep" as string]: mixColor(p, -0.35),
  }
}

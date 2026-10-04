/**
 * Quem é da equipe da plataforma (e pode enviar a lista da Caixa em
 * `/plataforma/caixa`): os e-mails de `PLATFORM_ADMIN_EMAILS`.
 *
 * Função pura, sem ler ambiente: o servidor passa o valor da variável e o
 * e-mail CONFIRMADO do usuário logado. Falha fechada — variável vazia ou
 * ausente quer dizer "ninguém".
 */

/** Separadores aceitos entre e-mails: vírgula (o formato documentado), ponto e vírgula e espaço. */
const SEPARATORS = /[\s,;]+/

/** Forma mínima de e-mail: algo@algo, sem espaço. */
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+$/

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase()
}

/** Lista da variável `PLATFORM_ADMIN_EMAILS`, em minúsculas e sem repetição. */
export function parsePlatformAdminEmails(raw: string | null | undefined): Set<string> {
  const emails = new Set<string>()

  if (typeof raw !== "string") {
    return emails
  }

  for (const part of raw.split(SEPARATORS)) {
    const email = normalizeEmail(part)

    if (EMAIL_SHAPE.test(email)) {
      emails.add(email)
    }
  }

  return emails
}

/** O e-mail está na lista? Comparação sem diferenciar maiúsculas. */
export function isPlatformAdminEmail(email: unknown, raw: string | null | undefined): boolean {
  if (typeof email !== "string") {
    return false
  }

  const normalized = normalizeEmail(email)

  if (!EMAIL_SHAPE.test(normalized)) {
    return false
  }

  return parsePlatformAdminEmails(raw).has(normalized)
}

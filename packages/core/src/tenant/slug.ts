// Slug da imobiliária usado como subdomínio ({slug}.{domínio raiz}).
// Módulo puro (sem env, sem I/O): serve ao proxy, ao servidor e ao navegador.

/**
 * Subdomínios que nunca podem ser slug de imobiliária.
 *
 * ATENÇÃO: manter igual a `private.is_reserved_subdomain` no banco
 * (supabase/migrations); há um teste no banco comparando as duas listas.
 */
export const RESERVED_SUBDOMAINS: ReadonlySet<string> = new Set([
  "www",
  "app",
  "api",
  "admin",
  "auth",
  "login",
  "entrar",
  "cadastro",
  "onboarding",
  "painel",
  "dashboard",
  "conta",
  "mail",
  "email",
  "smtp",
  "imap",
  "pop",
  "ftp",
  "ns1",
  "ns2",
  "blog",
  "docs",
  "ajuda",
  "suporte",
  "status",
  "static",
  "cdn",
  "assets",
  "img",
  "media",
  "files",
  "storage",
  "dev",
  "staging",
  "preview",
  "lp",
  "feeds",
  "captar",
  "convite",
])

export const TENANT_SLUG_MIN_LENGTH = 3
export const TENANT_SLUG_MAX_LENGTH = 60

/** Motivo de um slug recusado (a mensagem ao usuário fica com quem chama). */
export type TenantSlugIssue = "length" | "characters" | "hyphens" | "reserved"

const TENANT_SLUG_CHARACTERS = /^[a-z0-9-]+$/

/**
 * Por que o slug não serve como subdomínio; `null` quando serve.
 *
 * Regras: 3 a 60 caracteres, só `a-z`, `0-9` e hífen, sem hífen nas pontas e
 * sem hífens seguidos. Proibir `--` em qualquer posição também recusa rótulos
 * IDN/punycode (`xn--...`), que o navegador pode exibir com letras parecidas
 * com as de outra marca. O banco é um pouco mais permissivo (só recusa `--`
 * nas posições 3 e 4): todo slug aceito aqui também é aceito lá.
 */
export function getTenantSlugIssue(slug: string): TenantSlugIssue | null {
  if (slug.length < TENANT_SLUG_MIN_LENGTH || slug.length > TENANT_SLUG_MAX_LENGTH) {
    return "length"
  }

  if (!TENANT_SLUG_CHARACTERS.test(slug)) {
    return "characters"
  }

  if (slug.startsWith("-") || slug.endsWith("-") || slug.includes("--")) {
    return "hyphens"
  }

  if (RESERVED_SUBDOMAINS.has(slug)) {
    return "reserved"
  }

  return null
}

export function isValidTenantSlug(value: unknown): value is string {
  return typeof value === "string" && getTenantSlugIssue(value) === null
}

/**
 * Limpa o slug enquanto a pessoa digita: tira acentos, passa para minúsculas e
 * troca qualquer outro caractere (espaço, vírgula, ponto, barra) por um único
 * hífen, sem hífen no início. O hífen do fim fica, para dar para continuar
 * digitando ("horizonte-" e depois "imoveis"); `finishTenantSlugInput` o
 * remove ao sair do campo.
 */
export function sanitizeTenantSlugInput(value: string, maxLength = TENANT_SLUG_MAX_LENGTH): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+/, "")
    .slice(0, maxLength)
}

/** Versão final do slug digitado (ao sair do campo): sem hífen no fim. */
export function finishTenantSlugInput(value: string, maxLength = TENANT_SLUG_MAX_LENGTH): string {
  return sanitizeTenantSlugInput(value, maxLength).replace(/-+$/, "")
}

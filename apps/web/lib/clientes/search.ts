/**
 * Termo de busca seguro para os filtros `.or()` do PostgREST: remove vírgula,
 * parênteses, aspas e curingas (que quebrariam ou ampliariam o filtro).
 */
export function sanitizeSearchTerm(value: unknown, maxLength = 80) {
  if (typeof value !== "string") {
    return ""
  }

  return value
    .replace(/[,()"'`\\%_*:]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength)
}

/** Filtro `.or()` para clientes: nome, nome fantasia, e-mail, telefones e documento. */
export function buildClientSearchFilter(term: string) {
  const filters = [`name.ilike.%${term}%`, `trade_name.ilike.%${term}%`, `email.ilike.%${term}%`]

  const digits = term.replace(/\D/g, "")
  const alphanumeric = term.toUpperCase().replace(/[^0-9A-Z]/g, "")

  if (digits.length >= 3) {
    filters.push(`phone.ilike.%${digits}%`, `whatsapp.ilike.%${digits}%`)
  }

  if (alphanumeric.length >= 3 && /\d/.test(alphanumeric)) {
    filters.push(`document.ilike.%${alphanumeric}%`)
  }

  return filters.join(",")
}

/** Filtro `.or()` para imóveis: código, título e bairro. */
export function buildPropertySearchFilter(term: string) {
  return [`code.ilike.%${term}%`, `title.ilike.%${term}%`, `neighborhood.ilike.%${term}%`].join(",")
}

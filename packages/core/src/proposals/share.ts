// Link público da proposta (/proposta/{token}): formato do token, caminho e
// validade. Módulo puro: sem env, sem I/O.
//
// O token segue o mesmo desenho do feed dos portais: 24 bytes aleatórios em
// hex, gerados no banco (extensions.gen_random_bytes) e nunca no app. A RPC
// get_shared_proposal devolve null para token errado, revogado ou vencido, sem
// distinguir os casos.

/** Prefixo da rota pública, em qualquer host (raiz, subdomínio ou host único). */
export const PROPOSAL_SHARE_PATH_PREFIX = "/proposta"

/** Formato de proposal_shares.token (24 bytes aleatórios em hex). */
export const PROPOSAL_SHARE_TOKEN_PATTERN = /^[0-9a-f]{48}$/

export const PROPOSAL_SHARE_MIN_DAYS = 1
export const PROPOSAL_SHARE_MAX_DAYS = 180
export const PROPOSAL_SHARE_DEFAULT_DAYS = 30

/** Prazos oferecidos na tela (o banco aceita qualquer valor entre 1 e 180). */
export const PROPOSAL_SHARE_DAY_OPTIONS = [7, 15, 30, 60, 90] as const

export function isProposalShareToken(value: string | null | undefined): value is string {
  return typeof value === "string" && PROPOSAL_SHARE_TOKEN_PATTERN.test(value)
}

/** Mesma faixa de share_proposal (1 a 180 dias); valor inválido vira o padrão. */
export function clampProposalShareDays(days: number | null | undefined): number {
  if (typeof days !== "number" || !Number.isFinite(days)) {
    return PROPOSAL_SHARE_DEFAULT_DAYS
  }

  const rounded = Math.round(days)

  if (rounded < PROPOSAL_SHARE_MIN_DAYS) return PROPOSAL_SHARE_MIN_DAYS
  if (rounded > PROPOSAL_SHARE_MAX_DAYS) return PROPOSAL_SHARE_MAX_DAYS

  return rounded
}

/** Caminho relativo do link público. Token inválido lança: a URL nunca sai errada. */
export function buildProposalSharePath(token: string): string {
  if (!isProposalShareToken(token)) {
    throw new Error("Token do link da proposta inválido.")
  }

  return `${PROPOSAL_SHARE_PATH_PREFIX}/${token}`
}

/** Link ainda no prazo (espelho do `expires_at > now()` da RPC). */
export function isProposalShareActive(
  share: { token: string | null; expiresAt: string | null } | null | undefined,
  now: Date = new Date()
): boolean {
  if (!share || !isProposalShareToken(share.token) || !share.expiresAt) {
    return false
  }

  const expires = new Date(share.expiresAt)
  return !Number.isNaN(expires.getTime()) && expires.getTime() > now.getTime()
}

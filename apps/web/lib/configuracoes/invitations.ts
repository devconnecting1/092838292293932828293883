// Convites por link. Módulo puro (usado no servidor e no cliente).

import type { AppRole } from "@workspace/core/properties/enums"

import { isAppRole } from "@/lib/configuracoes/roles"

/** Mesmo prazo do default de invitations.expires_at. */
export const INVITATION_VALIDITY_DAYS = 7

/** invitations.token: 64 caracteres hex (dois uuid v4 sem hífens). */
export const INVITATION_TOKEN_PATTERN = /^[0-9a-f]{64}$/

export function isInvitationToken(value: string | null | undefined): value is string {
  return typeof value === "string" && INVITATION_TOKEN_PATTERN.test(value)
}

/** Caminho relativo do convite (vale no subdomínio e, por compatibilidade, na raiz). */
export function buildInvitationPath(token: string) {
  return `/convite/${token}`
}

// A URL absoluta do convite fica em lib/tenant/urls.ts (buildInvitationUrl),
// no subdomínio da imobiliária que convida.

export function getInvitationExpiry(now: Date = new Date()) {
  return new Date(now.getTime() + INVITATION_VALIDITY_DAYS * 24 * 60 * 60 * 1000)
}

export function isInvitationExpired(expiresAt: string, now: Date = new Date()) {
  const date = new Date(expiresAt)
  return Number.isNaN(date.getTime()) || date.getTime() < now.getTime()
}

type InvitationMessageInput = {
  organizationName: string
  roleLabel: string
  url: string
  expiresAtLabel: string
}

export function buildInvitationMessage({
  organizationName,
  roleLabel,
  url,
  expiresAtLabel,
}: InvitationMessageInput) {
  return [
    `Olá! Você foi convidado(a) para a equipe da ${organizationName} no CRM como ${roleLabel}.`,
    `Para aceitar, abra o link abaixo e entre (ou crie sua conta) com este mesmo e-mail:`,
    url,
    `O convite vale até ${expiresAtLabel}.`,
  ].join("\n\n")
}

export function buildWhatsAppShareUrl(message: string) {
  return `https://wa.me/?text=${encodeURIComponent(message)}`
}

export function buildMailtoUrl(email: string, subject: string, body: string) {
  const params = new URLSearchParams({ subject, body })
  // URLSearchParams usa "+" para espaço; clientes de e-mail esperam %20.
  return `mailto:${encodeURIComponent(email)}?${params.toString().replace(/\+/g, "%20")}`
}

/**
 * Motivo de um 42501 de `accept_invitation`. O banco usa o mesmo código para
 * casos diferentes; a distinção é pela mensagem (comparada por trecho, sem
 * acentos nem caixa, para tolerar pequenas mudanças de redação):
 * - "Confirme seu e-mail antes de aceitar o convite." → `email_not_confirmed`
 * - "Este convite foi enviado para outro e-mail." → `email_mismatch`
 * - "É preciso estar autenticado para aceitar o convite." → `unauthenticated`
 */
export type AcceptInvitationDenialReason =
  "email_not_confirmed" | "email_mismatch" | "unauthenticated" | "unknown"

function normalizeDatabaseMessage(message: string) {
  return message.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim()
}

export function classifyAcceptInvitationDenial(
  message: string | null | undefined
): AcceptInvitationDenialReason {
  const text = normalizeDatabaseMessage(message ?? "")

  if (/\bconfirm/.test(text) && /e-?mail/.test(text)) {
    return "email_not_confirmed"
  }

  if (/outro e-?mail/.test(text) || /enviado para outr/.test(text)) {
    return "email_mismatch"
  }

  if (/autenticad/.test(text)) {
    return "unauthenticated"
  }

  return "unknown"
}

/** Retorno de `get_invitation_preview` (ver supabase/README.md), já validado. */
export type InvitationPreview = {
  organizationName: string
  role: AppRole
  expiresAt: string
  expired: boolean
  accepted: boolean
  /** E-mail convidado mascarado, ex.: "ma***@gmail.com". Nunca o e-mail completo. */
  emailHint: string
}

/** Valida o `jsonb` da RPC `get_invitation_preview` (`null` quando o token não existe). */
export function parseInvitationPreview(data: unknown): InvitationPreview | null {
  if (!data || typeof data !== "object") {
    return null
  }

  const value = data as Record<string, unknown>
  const { organization_name, role, expires_at, expired, accepted, email_hint } = value

  if (
    typeof organization_name !== "string" ||
    typeof expires_at !== "string" ||
    typeof expired !== "boolean" ||
    typeof accepted !== "boolean" ||
    typeof email_hint !== "string" ||
    !isAppRole(role)
  ) {
    return null
  }

  return {
    organizationName: organization_name,
    role,
    expiresAt: expires_at,
    expired,
    accepted,
    emailHint: email_hint,
  }
}

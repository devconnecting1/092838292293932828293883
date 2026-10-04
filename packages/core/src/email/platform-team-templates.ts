// Modelos de e-mail da equipe do Console da Plataforma (pt-BR): o convite e o
// aviso aos Donos quando alguém entra, muda de papel ou sai. Mesmas garantias de
// templates.ts: todo dado é não confiável (limpo e escapado em layout.ts) e os
// links ficam presos à origem recebida.

import {
  PLATFORM_ROLE_DESCRIPTIONS,
  PLATFORM_ROLE_LABELS,
  PLATFORM_TEAM_PATH,
  isPlatformStaffRole,
  type PlatformStaffRole,
} from "../platform/staff"
import { renderEmail, DEFAULT_BRAND_NAME, type RenderedEmail } from "./layout"
import { cleanText, formatEmailDateTime, normalizeEmailAddress } from "./sanitize"
import { EmailTemplateError, requireLink, requireOrigin } from "./templates"

function requireRole(role: unknown): PlatformStaffRole {
  if (!isPlatformStaffRole(role)) {
    throw new EmailTemplateError("Papel inválido para o e-mail da equipe.")
  }

  return role
}

export type PlatformTeamInvitationEmailParams = {
  /** Origem do domínio raiz (ou do host único) da plataforma. */
  origin: string
  /** Link do convite com o token (absoluto na origem, ou caminho relativo). */
  invitationUrl: string
  role: PlatformStaffRole
  /** E-mail do Dono que convidou. */
  inviterEmail?: string | null
  expiresAt: Date | string
}

/** Convite para a equipe do Console da Plataforma. */
export function platformTeamInvitationEmail(
  params: PlatformTeamInvitationEmailParams
): RenderedEmail {
  const origin = requireOrigin(params.origin)
  const url = requireLink(params.invitationUrl, origin)
  const role = requireRole(params.role)
  const roleLabel = PLATFORM_ROLE_LABELS[role]
  const inviter = normalizeEmailAddress(params.inviterEmail)
  const validUntil = formatEmailDateTime(params.expiresAt)

  return renderEmail(null, {
    subject: `Convite para a equipe da plataforma ${DEFAULT_BRAND_NAME}`,
    preheader: validUntil
      ? `Você foi convidado como ${roleLabel}. O convite vale até ${validUntil}.`
      : `Você foi convidado como ${roleLabel}.`,
    heading: "Convite para a equipe da plataforma",
    greeting: "Olá!",
    paragraphs: [
      `${inviter ?? "O Dono da plataforma"} convidou você para o Console da Plataforma do ${DEFAULT_BRAND_NAME} (a área interna de quem administra o sistema) com o papel ${roleLabel}.`,
      PLATFORM_ROLE_DESCRIPTIONS[role],
    ],
    details: [
      { label: "Papel", value: roleLabel },
      { label: "Convidado por", value: inviter },
      { label: "Válido até", value: validUntil },
    ],
    action: { label: "Ver o convite", url },
    closing: [
      "Para aceitar, entre ou crie sua conta com este mesmo e-mail, confirme o endereço e clique em Aceitar convite. O link é pessoal e vale uma vez só: não o compartilhe.",
    ],
    footer:
      "Você recebeu este e-mail porque o Dono da plataforma convidou este endereço para a equipe. Se não esperava o convite, ignore a mensagem: nenhum acesso é liberado sem que alguém entre com este e-mail e aceite.",
  })
}

export type PlatformTeamNoticeKind = "joined" | "role_changed" | "removed"

export type PlatformTeamNoticeEmailParams = {
  origin: string
  kind: PlatformTeamNoticeKind
  /** E-mail da pessoa da equipe afetada. */
  memberEmail: string
  /** joined: papel de entrada; role_changed: papel novo; removed: papel que tinha. */
  role: PlatformStaffRole
  /** role_changed: papel anterior. */
  previousRole?: PlatformStaffRole | null
  /** Quem fez a mudança (role_changed e removed). */
  actorEmail?: string | null
  occurredAt: Date | string
}

/** Aviso aos Donos: alguém entrou na equipe, mudou de papel ou saiu. */
export function platformTeamNoticeEmail(params: PlatformTeamNoticeEmailParams): RenderedEmail {
  const origin = requireOrigin(params.origin)
  const url = requireLink(PLATFORM_TEAM_PATH, origin)
  const member = normalizeEmailAddress(params.memberEmail)

  if (!member) {
    throw new EmailTemplateError("E-mail da pessoa da equipe inválido.")
  }

  const role = requireRole(params.role)
  const roleLabel = PLATFORM_ROLE_LABELS[role]
  const previousRole = isPlatformStaffRole(params.previousRole)
    ? PLATFORM_ROLE_LABELS[params.previousRole]
    : null
  const actor = normalizeEmailAddress(params.actorEmail)
  const when = formatEmailDateTime(params.occurredAt)
  const footer =
    "Você recebeu este aviso porque seu endereço está na lista de Donos da plataforma (PLATFORM_ADMIN_EMAILS). Se não reconhece esta mudança, abra a equipe e remova o acesso."

  switch (params.kind) {
    case "joined":
      return renderEmail(null, {
        subject: `${member} entrou na equipe da plataforma como ${roleLabel}`,
        preheader: `Convite aceito: ${member} agora acessa o Console da Plataforma.`,
        heading: "Nova pessoa na equipe da plataforma",
        greeting: "Olá!",
        paragraphs: [
          `${member} aceitou o convite e entrou na equipe do Console da Plataforma como ${roleLabel}.`,
          PLATFORM_ROLE_DESCRIPTIONS[role],
        ],
        details: [
          { label: "Pessoa", value: member },
          { label: "Papel", value: roleLabel },
          { label: "Quando", value: when },
        ],
        action: { label: "Abrir a equipe", url },
        footer,
      })
    case "role_changed":
      return renderEmail(null, {
        subject: `${member} agora é ${roleLabel} na equipe da plataforma`,
        preheader: `O papel de ${member} no Console da Plataforma mudou.`,
        heading: "Papel alterado na equipe da plataforma",
        greeting: "Olá!",
        paragraphs: [
          `${actor ?? "Um Dono"} mudou o papel de ${member} ${previousRole ? `de ${previousRole} ` : ""}para ${roleLabel}. A mudança vale a partir do próximo clique da pessoa no console.`,
        ],
        details: [
          { label: "Pessoa", value: member },
          { label: "Papel anterior", value: previousRole },
          { label: "Papel novo", value: roleLabel },
          { label: "Alterado por", value: actor },
          { label: "Quando", value: when },
        ],
        action: { label: "Abrir a equipe", url },
        footer,
      })
    case "removed":
      return renderEmail(null, {
        subject: `${member} saiu da equipe da plataforma`,
        preheader: `${member} não acessa mais o Console da Plataforma.`,
        heading: "Pessoa removida da equipe da plataforma",
        greeting: "Olá!",
        paragraphs: [
          `${actor && actor !== member ? `${actor} removeu ${member}` : `${member} saiu`} da equipe do Console da Plataforma. O acesso acabou na hora.`,
        ],
        details: [
          { label: "Pessoa", value: member },
          { label: "Papel que tinha", value: roleLabel },
          { label: "Removido por", value: actor },
          { label: "Quando", value: when },
        ],
        action: { label: "Abrir a equipe", url },
        footer,
      })
    default:
      throw new EmailTemplateError(
        `Tipo de aviso da equipe inválido: ${cleanText(String(params.kind), { maxLength: 30 })}`
      )
  }
}

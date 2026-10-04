import "server-only"

import { createHash, randomBytes } from "node:crypto"

import {
  platformTeamInvitationEmail,
  platformTeamNoticeEmail,
  type PlatformTeamNoticeKind,
} from "@workspace/core/email/platform-team-templates"
import {
  buildPlatformTeamInvitationPath,
  canManagePlatformTeam,
  isPlatformStaffRole,
  isPlatformTeamErrorCode,
  isPlatformTeamId,
  parsePlatformTeamInvitationPreview,
  parsePlatformTeamSnapshot,
  PLATFORM_TEAM_ERROR_MESSAGES,
  PLATFORM_TEAM_OWNER_ONLY_MESSAGE,
  type PlatformStaffRole,
  type PlatformTeamErrorCode,
  type PlatformTeamInvitationPreview,
  type PlatformTeamSnapshot,
} from "@workspace/core/platform/staff"

import { getEmailProvider } from "@/lib/email"
import { deriveIdempotencyKey } from "@/lib/email/idempotency"
import { getPlatformOwnerEmails } from "@/lib/plataforma/admin"
import {
  PlatformRpcError,
  throwPlatformRpcError,
  withPlatformRpc,
  type PlatformRpcResult,
} from "@/lib/plataforma/rpc"
import { createPlatformServerKeyClient } from "@/lib/plataforma/server-key-client"
import { buildAppUrl, getAppOrigin } from "@/lib/tenant/urls"

/**
 * Equipe do Console da Plataforma (/plataforma/equipe e /convite/equipe/{token}).
 *
 * - Gestão (listar, convidar, reenviar, revogar, mudar papel, remover): por
 *   `withPlatformRpc`, que confere a pessoa da equipe; as ações de escrita
 *   conferem de novo que é Dono. As RPCs gravam o registro do console na mesma
 *   transação.
 * - Prévia e aceite do convite: a pessoa ainda não é da equipe, então usam o
 *   cliente com a chave do servidor (`createPlatformServerKeyClient`). O id da
 *   conta vem da sessão conferida pela página ou pela action.
 *
 * O token do link é gerado aqui (32 bytes aleatórios) e só vai no e-mail; o
 * banco recebe o hash SHA-256. Nada de token, e-mail completo ou texto do banco
 * nos logs.
 */

type RpcErrorLike = { code?: string | null; message?: string | null } | null | undefined

export type TeamActionOutcome<T = undefined> = { ok: true; data: T } | { ok: false; error: string }

type UnknownRecord = Record<string, unknown>

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null
}

// ---------------------------------------------------------------------------
// Token
// ---------------------------------------------------------------------------

export function hashPlatformTeamInvitationToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex")
}

function generateInvitationToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString("base64url")
  return { token, tokenHash: hashPlatformTeamInvitationToken(token) }
}

/** Erro conhecido da RPC → frase pronta; o resto vira PlatformRpcError (só o código no log). */
function expectedTeamError(operation: string, error: RpcErrorLike): string {
  const code = error?.code ?? ""
  const message = error?.message

  if (["P0001", "P0002", "22023", "42501"].includes(code) && isPlatformTeamErrorCode(message)) {
    return PLATFORM_TEAM_ERROR_MESSAGES[message]
  }

  throwPlatformRpcError(operation, error)
}

function toOutcome<T>(result: PlatformRpcResult<TeamActionOutcome<T>>): TeamActionOutcome<T> {
  return result.ok ? result.data : { ok: false, error: result.message }
}

// ---------------------------------------------------------------------------
// Leitura
// ---------------------------------------------------------------------------

/** Donos (da variável), pessoas ativas, convites abertos e travas de envio. */
export async function listPlatformTeam(): Promise<PlatformRpcResult<PlatformTeamSnapshot>> {
  const operation = "platform_staff_list"

  return withPlatformRpc(operation, async ({ supabase, serverKey }) => {
    const { data, error } = await supabase.rpc(operation, {
      p_server_key: serverKey,
      p_owner_emails: getPlatformOwnerEmails(),
    })

    if (error) {
      throwPlatformRpcError(operation, error)
    }

    const snapshot = parsePlatformTeamSnapshot(data)

    if (!snapshot) {
      throw new PlatformRpcError(operation, null, "dados_invalidos")
    }

    return snapshot
  })
}

// ---------------------------------------------------------------------------
// Convites (só o Dono)
// ---------------------------------------------------------------------------

export type InvitationDelivery = "enviado" | "simulado" | "falhou"

export type IssuedInvitation = {
  invitationId: string
  email: string
  role: PlatformStaffRole
  expiresAt: string
  resent: boolean
  delivery: InvitationDelivery
  /**
   * Link do convite, devolvido só ao Dono quando o e-mail não saiu (falha ou
   * modo simulado), para ele mandar por outro meio. Com o e-mail enviado, fica
   * só no e-mail.
   */
  manualLink: string | null
}

function parseIssued(
  operation: string,
  data: unknown
): Omit<IssuedInvitation, "delivery" | "manualLink"> {
  const invitationId = isRecord(data) ? data.invitation_id : null
  const email = isRecord(data) ? text(data.email) : null
  const role = isRecord(data) ? data.role : null
  const expiresAt = isRecord(data) ? text(data.expires_at) : null

  if (!isPlatformTeamId(invitationId) || !email || !isPlatformStaffRole(role) || !expiresAt) {
    throw new PlatformRpcError(operation, null, "dados_invalidos")
  }

  return {
    invitationId,
    email,
    role,
    expiresAt,
    resent: isRecord(data) && data.resent === true,
  }
}

async function deliverInvitation(
  invitation: Omit<IssuedInvitation, "delivery" | "manualLink">,
  token: string,
  inviterEmail: string
): Promise<Pick<IssuedInvitation, "delivery" | "manualLink">> {
  const link = buildAppUrl(buildPlatformTeamInvitationPath(token))
  let email

  try {
    email = platformTeamInvitationEmail({
      origin: getAppOrigin(),
      invitationUrl: link,
      role: invitation.role,
      inviterEmail,
      expiresAt: invitation.expiresAt,
    })
  } catch (cause) {
    console.error(
      `[plataforma/equipe] e-mail do convite não montado (${cause instanceof Error ? cause.name : "erro"})`
    )
    return { delivery: "falhou", manualLink: link }
  }

  const provider = getEmailProvider()
  const result = await provider.send({
    to: { email: invitation.email },
    subject: email.subject,
    html: email.html,
    text: email.text,
    tags: ["plataforma_equipe_convite"],
    quota: { kind: "platform_team_invitation" },
    // Novo prazo a cada reenvio: o reenvio não é tratado como repetição.
    idempotencyKey: deriveIdempotencyKey(
      "platform_team_invitation",
      invitation.invitationId,
      invitation.expiresAt
    ),
  })

  if (!result.ok) {
    console.error(`[plataforma/equipe] convite não enviado (${result.reason})`)
    return { delivery: "falhou", manualLink: link }
  }

  return provider.kind === "simulated"
    ? { delivery: "simulado", manualLink: link }
    : { delivery: "enviado", manualLink: null }
}

/** Convida (ou reenvia, se já houver convite aberto para o e-mail) e manda o e-mail. */
export async function invitePlatformTeamMember(input: {
  email: string
  role: PlatformStaffRole
}): Promise<TeamActionOutcome<IssuedInvitation>> {
  const operation = "platform_staff_invite"
  const { token, tokenHash } = generateInvitationToken()

  const result = await withPlatformRpc(
    operation,
    async ({ supabase, serverKey, admin }): Promise<TeamActionOutcome<IssuedInvitation>> => {
      if (!canManagePlatformTeam(admin.role)) {
        return { ok: false, error: PLATFORM_TEAM_OWNER_ONLY_MESSAGE }
      }

      const { data, error } = await supabase.rpc(operation, {
        p_server_key: serverKey,
        p_actor_user_id: admin.id,
        p_actor_email: admin.email,
        p_email: input.email,
        p_role: input.role,
        p_token_hash: tokenHash,
      })

      if (error) {
        return { ok: false, error: expectedTeamError(operation, error) }
      }

      const issued = parseIssued(operation, data)
      const delivery = await deliverInvitation(issued, token, admin.email)

      return { ok: true, data: { ...issued, ...delivery } }
    }
  )

  return toOutcome(result)
}

/** Reenvia um convite aberto: novo link (o antigo para de valer) e mais 7 dias. */
export async function resendPlatformTeamInvitation(
  invitationId: string
): Promise<TeamActionOutcome<IssuedInvitation>> {
  const operation = "platform_staff_resend_invitation"
  const { token, tokenHash } = generateInvitationToken()

  const result = await withPlatformRpc(
    operation,
    async ({ supabase, serverKey, admin }): Promise<TeamActionOutcome<IssuedInvitation>> => {
      if (!canManagePlatformTeam(admin.role)) {
        return { ok: false, error: PLATFORM_TEAM_OWNER_ONLY_MESSAGE }
      }

      const { data, error } = await supabase.rpc(operation, {
        p_server_key: serverKey,
        p_actor_user_id: admin.id,
        p_actor_email: admin.email,
        p_invitation_id: invitationId,
        p_token_hash: tokenHash,
      })

      if (error) {
        return { ok: false, error: expectedTeamError(operation, error) }
      }

      const issued = parseIssued(operation, data)
      const delivery = await deliverInvitation(issued, token, admin.email)

      return { ok: true, data: { ...issued, ...delivery } }
    }
  )

  return toOutcome(result)
}

export async function revokePlatformTeamInvitation(
  invitationId: string
): Promise<TeamActionOutcome> {
  const operation = "platform_staff_revoke_invitation"

  const result = await withPlatformRpc(
    operation,
    async ({ supabase, serverKey, admin }): Promise<TeamActionOutcome> => {
      if (!canManagePlatformTeam(admin.role)) {
        return { ok: false, error: PLATFORM_TEAM_OWNER_ONLY_MESSAGE }
      }

      const { error } = await supabase.rpc(operation, {
        p_server_key: serverKey,
        p_actor_user_id: admin.id,
        p_actor_email: admin.email,
        p_invitation_id: invitationId,
      })

      if (error) {
        return { ok: false, error: expectedTeamError(operation, error) }
      }

      return { ok: true, data: undefined }
    }
  )

  return toOutcome(result)
}

// ---------------------------------------------------------------------------
// Pessoas (só o Dono)
// ---------------------------------------------------------------------------

export async function setPlatformTeamMemberRole(input: {
  userId: string
  role: PlatformStaffRole
}): Promise<TeamActionOutcome<{ previousRole: PlatformStaffRole }>> {
  const operation = "platform_staff_set_role"

  const result = await withPlatformRpc(
    operation,
    async ({
      supabase,
      serverKey,
      admin,
    }): Promise<TeamActionOutcome<{ previousRole: PlatformStaffRole }>> => {
      if (!canManagePlatformTeam(admin.role)) {
        return { ok: false, error: PLATFORM_TEAM_OWNER_ONLY_MESSAGE }
      }

      const { data, error } = await supabase.rpc(operation, {
        p_server_key: serverKey,
        p_actor_user_id: admin.id,
        p_actor_email: admin.email,
        p_user_id: input.userId,
        p_role: input.role,
      })

      if (error) {
        return { ok: false, error: expectedTeamError(operation, error) }
      }

      const previousRole = isRecord(data) ? data.role_before : null

      if (!isPlatformStaffRole(previousRole)) {
        throw new PlatformRpcError(operation, null, "dados_invalidos")
      }

      return { ok: true, data: { previousRole } }
    }
  )

  return toOutcome(result)
}

export async function removePlatformTeamMember(
  userId: string
): Promise<TeamActionOutcome<{ role: PlatformStaffRole }>> {
  const operation = "platform_staff_remove"

  const result = await withPlatformRpc(
    operation,
    async ({
      supabase,
      serverKey,
      admin,
    }): Promise<TeamActionOutcome<{ role: PlatformStaffRole }>> => {
      if (!canManagePlatformTeam(admin.role)) {
        return { ok: false, error: PLATFORM_TEAM_OWNER_ONLY_MESSAGE }
      }

      const { data, error } = await supabase.rpc(operation, {
        p_server_key: serverKey,
        p_actor_user_id: admin.id,
        p_actor_email: admin.email,
        p_user_id: userId,
      })

      if (error) {
        return { ok: false, error: expectedTeamError(operation, error) }
      }

      const role = isRecord(data) ? data.role : null

      if (!isPlatformStaffRole(role)) {
        throw new PlatformRpcError(operation, null, "dados_invalidos")
      }

      return { ok: true, data: { role } }
    }
  )

  return toOutcome(result)
}

// ---------------------------------------------------------------------------
// Prévia e aceite (a pessoa ainda não é da equipe)
// ---------------------------------------------------------------------------

export type InvitationPreviewResult =
  { ok: true; preview: PlatformTeamInvitationPreview | null } | { ok: false }

/** Prévia pelo token: situação, papel e validade (nunca o e-mail convidado). */
export async function previewPlatformTeamInvitation(
  token: string,
  userId: string | null
): Promise<InvitationPreviewResult> {
  const client = createPlatformServerKeyClient()

  if (!client) {
    console.error("[plataforma/equipe] prévia do convite sem PLATFORM_SERVER_KEY ou Supabase")
    return { ok: false }
  }

  const { data, error } = await client.supabase.rpc("platform_staff_invitation_preview", {
    p_server_key: client.serverKey,
    p_token_hash: hashPlatformTeamInvitationToken(token),
    p_user_id: userId ?? undefined,
  })

  if (error) {
    console.error(
      `[plataforma/equipe] platform_staff_invitation_preview falhou (código ${error.code ?? "desconhecido"})`
    )
    return { ok: false }
  }

  return { ok: true, preview: parsePlatformTeamInvitationPreview(data) }
}

export type AcceptedInvitation = {
  email: string
  role: PlatformStaffRole
  rejoined: boolean
}

export type AcceptInvitationOutcome =
  | { ok: true; data: AcceptedInvitation }
  | { ok: false; code: PlatformTeamErrorCode | null; error: string }

const ACCEPT_UNAVAILABLE = "Não foi possível aceitar o convite agora. Tente de novo em instantes."

/** Aceite: o banco confere e-mail igual ao convidado, confirmado, e o token. */
export async function acceptPlatformTeamInvitation(
  token: string,
  userId: string
): Promise<AcceptInvitationOutcome> {
  const operation = "platform_staff_accept_invitation"
  const client = createPlatformServerKeyClient()

  if (!client) {
    console.error("[plataforma/equipe] aceite do convite sem PLATFORM_SERVER_KEY ou Supabase")
    return { ok: false, code: null, error: ACCEPT_UNAVAILABLE }
  }

  const { data, error } = await client.supabase.rpc(operation, {
    p_server_key: client.serverKey,
    p_user_id: userId,
    p_token_hash: hashPlatformTeamInvitationToken(token),
  })

  if (error) {
    const message = error.message

    if (isPlatformTeamErrorCode(message)) {
      return { ok: false, code: message, error: PLATFORM_TEAM_ERROR_MESSAGES[message] }
    }

    console.error(
      `[plataforma/equipe] ${operation} falhou (código ${error.code ?? "desconhecido"})`
    )
    return { ok: false, code: null, error: ACCEPT_UNAVAILABLE }
  }

  const email = isRecord(data) ? text(data.email) : null
  const role = isRecord(data) ? data.role : null

  if (!email || !isPlatformStaffRole(role)) {
    console.error(`[plataforma/equipe] ${operation} respondeu fora do formato`)
    return { ok: false, code: null, error: ACCEPT_UNAVAILABLE }
  }

  return { ok: true, data: { email, role, rejoined: isRecord(data) && data.rejoined === true } }
}

// ---------------------------------------------------------------------------
// Aviso aos Donos
// ---------------------------------------------------------------------------

export type TeamChangeNotice = {
  kind: PlatformTeamNoticeKind
  memberUserId: string
  memberEmail: string
  role: PlatformStaffRole
  previousRole?: PlatformStaffRole | null
  actorEmail?: string | null
  occurredAt: string
}

/**
 * Avisa por e-mail todos os Donos (PLATFORM_ADMIN_EMAILS) que alguém entrou na
 * equipe, mudou de papel ou saiu. Feita para rodar em `after()`: nunca lança e
 * registra só contagens.
 */
export async function notifyPlatformOwnersOfTeamChange(notice: TeamChangeNotice): Promise<void> {
  const owners = getPlatformOwnerEmails()

  if (owners.length === 0) {
    return
  }

  let email

  try {
    email = platformTeamNoticeEmail({
      origin: getAppOrigin(),
      kind: notice.kind,
      memberEmail: notice.memberEmail,
      role: notice.role,
      previousRole: notice.previousRole,
      actorEmail: notice.actorEmail,
      occurredAt: notice.occurredAt,
    })
  } catch (cause) {
    console.error(
      `[plataforma/equipe] aviso aos Donos não montado (${cause instanceof Error ? cause.name : "erro"})`
    )
    return
  }

  const provider = getEmailProvider()
  let sent = 0
  let failed = 0

  for (const owner of owners) {
    try {
      const result = await provider.send({
        to: { email: owner },
        subject: email.subject,
        html: email.html,
        text: email.text,
        tags: ["plataforma_equipe_aviso"],
        quota: { kind: "platform_team_notice" },
        idempotencyKey: deriveIdempotencyKey(
          "platform_team_notice",
          notice.kind,
          notice.memberUserId,
          notice.occurredAt,
          owner
        ),
      })

      if (result.ok) {
        sent += 1
      } else {
        failed += 1
      }
    } catch {
      failed += 1
    }
  }

  if (failed > 0) {
    console.error(
      `[plataforma/equipe] aviso "${notice.kind}" aos Donos: ${sent} enviados, ${failed} falharam`
    )
  }
}

/**
 * Console da Plataforma — equipe (papéis e convites).
 *
 * Regras puras, usadas no servidor e na tela:
 * - Dono (`owner`): quem está em PLATFORM_ADMIN_EMAILS (variável do servidor).
 *   É a raiz: o único que convida, muda o papel e remove pessoas. Não fica no
 *   banco e não aparece como removível.
 * - Administrador (`admin`): usa todas as ações do console, mas não gerencia a
 *   equipe.
 * - Somente leitura (`viewer`): vê todas as telas e não executa nenhuma ação.
 *
 * Os papéis `admin` e `viewer` ficam em `private.platform_staff` e chegam por
 * convite com link (token aleatório; no banco só o hash SHA-256).
 */

export const PLATFORM_ROLES = ["owner", "admin", "viewer"] as const
export type PlatformRole = (typeof PLATFORM_ROLES)[number]

/** Papéis que se convida e que ficam no banco (o Dono vem da variável). */
export const PLATFORM_STAFF_ROLES = ["admin", "viewer"] as const
export type PlatformStaffRole = (typeof PLATFORM_STAFF_ROLES)[number]

export const PLATFORM_ROLE_LABELS: Record<PlatformRole, string> = {
  owner: "Dono",
  admin: "Administrador",
  viewer: "Somente leitura",
}

export const PLATFORM_ROLE_DESCRIPTIONS: Record<PlatformRole, string> = {
  owner:
    "Definido na configuração do servidor. É o único que convida, muda o papel e remove pessoas da equipe.",
  admin:
    "Usa todas as ações do console (bloquear imobiliária, prorrogar teste, comunicados, envio da Caixa, página de status), mas não gerencia a equipe.",
  viewer: "Vê todas as telas do console, mas não executa nenhuma ação.",
}

const ROLE_RANK: Record<PlatformRole, number> = { viewer: 1, admin: 2, owner: 3 }

export function isPlatformRole(value: unknown): value is PlatformRole {
  return typeof value === "string" && (PLATFORM_ROLES as readonly string[]).includes(value)
}

export function isPlatformStaffRole(value: unknown): value is PlatformStaffRole {
  return typeof value === "string" && (PLATFORM_STAFF_ROLES as readonly string[]).includes(value)
}

/** O papel alcança o mínimo pedido? (Dono > Administrador > Somente leitura) */
export function hasPlatformRole(role: PlatformRole | null | undefined, min: PlatformRole): boolean {
  return isPlatformRole(role) && ROLE_RANK[role] >= ROLE_RANK[min]
}

/** Pode executar ações do console (Dono e Administrador). */
export function canActOnPlatform(role: PlatformRole | null | undefined): boolean {
  return hasPlatformRole(role, "admin")
}

/** Pode convidar, mudar o papel e remover pessoas da equipe (só o Dono). */
export function canManagePlatformTeam(role: PlatformRole | null | undefined): boolean {
  return role === "owner"
}

export const PLATFORM_READ_ONLY_MESSAGE =
  "Seu acesso ao Console da Plataforma é somente leitura: você pode ver as telas, mas não executar ações."

export const PLATFORM_TEAM_OWNER_ONLY_MESSAGE =
  "Só o Dono da plataforma convida, muda o papel e remove pessoas da equipe."

// ---------------------------------------------------------------------------
// Convites
// ---------------------------------------------------------------------------

export const PLATFORM_TEAM_PATH = "/plataforma/equipe"

/**
 * Página de aceite, fora do layout do console (que dá 404 para quem ainda não
 * é da equipe). Fica sob /convite: pública no proxy, atendida no domínio raiz e
 * já aceita como `next` do login e do cadastro.
 */
export const PLATFORM_TEAM_INVITATION_PATH_PREFIX = "/convite/equipe/"

/** Mesmos números do banco (private.platform_staff_issue_invitation). */
export const PLATFORM_TEAM_INVITATION_VALIDITY_DAYS = 7
export const PLATFORM_TEAM_MAX_PENDING_INVITATIONS = 20
export const PLATFORM_TEAM_MAX_SENDS_PER_DAY = 30

/** Token do link: 32 bytes aleatórios em base64url (43 caracteres). */
export const PLATFORM_TEAM_INVITATION_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/

/** Hash SHA-256 do token em hexadecimal (o que o banco guarda). */
export const PLATFORM_TEAM_TOKEN_HASH_PATTERN = /^[0-9a-f]{64}$/

export function isPlatformTeamInvitationToken(value: unknown): value is string {
  return typeof value === "string" && PLATFORM_TEAM_INVITATION_TOKEN_PATTERN.test(value)
}

export function buildPlatformTeamInvitationPath(token: string): string {
  return `${PLATFORM_TEAM_INVITATION_PATH_PREFIX}${token}`
}

/** Mesmo formato aceito pelo banco (private.platform_staff_normalize_email). */
const INVITE_EMAIL_PATTERN = /^[a-z0-9._%+'-]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/

/** E-mail do convite em minúsculas e sem espaços, ou null se inválido. */
export function normalizePlatformTeamEmail(value: unknown): string | null {
  if (typeof value !== "string") {
    return null
  }

  const email = value.trim().toLowerCase()

  return email.length >= 6 && email.length <= 254 && INVITE_EMAIL_PATTERN.test(email) ? email : null
}

// ---------------------------------------------------------------------------
// Erros das RPCs (a mensagem do erro é o código)
// ---------------------------------------------------------------------------

export const PLATFORM_TEAM_ERROR_MESSAGES = {
  email_invalido: "Informe um e-mail válido.",
  papel_invalido: "Escolha Administrador ou Somente leitura.",
  token_invalido: "Não foi possível gerar o link do convite. Tente de novo.",
  convite_para_si: "Você não pode convidar o seu próprio e-mail.",
  ja_e_da_equipe: "Este e-mail já faz parte da equipe da plataforma.",
  limite_diario_de_envios: `Limite de ${PLATFORM_TEAM_MAX_SENDS_PER_DAY} envios de convite em 24 horas atingido (o plano gratuito de e-mail tem cota diária). Tente de novo amanhã.`,
  reenvio_muito_rapido: "Este convite acabou de ser enviado. Espere um minuto para reenviar.",
  limite_de_convites: `Já há ${PLATFORM_TEAM_MAX_PENDING_INVITATIONS} convites pendentes. Revogue algum antes de convidar mais alguém.`,
  convite_nao_encontrado: "Convite não encontrado. Atualize a página.",
  convite_encerrado: "Este convite já foi aceito ou revogado. Atualize a página.",
  membro_nao_encontrado: "Esta pessoa não está mais na equipe. Atualize a página.",
  papel_igual: "Esta pessoa já tem esse papel.",
  somente_dono:
    "Sua conta também está na lista da equipe como Administrador ou Somente leitura. Remova a sua própria linha da lista e tente de novo.",
  convite_invalido:
    "Este link de convite não é válido. Confira se copiou o endereço inteiro ou peça um novo convite.",
  convite_revogado: "Este convite foi cancelado. Peça um novo convite ao Dono da plataforma.",
  convite_usado: "Este convite já foi usado.",
  convite_expirado: "Este convite expirou. Peça um novo convite ao Dono da plataforma.",
  email_diferente:
    "Este convite foi enviado para outro e-mail. Saia e entre com o e-mail que recebeu o convite.",
  email_nao_confirmado:
    "Confirme o seu e-mail pelo link que enviamos no cadastro e depois volte a este convite.",
  conta_invalida: "Sua sessão expirou. Entre de novo e volte a este convite.",
} as const satisfies Record<string, string>

export type PlatformTeamErrorCode = keyof typeof PLATFORM_TEAM_ERROR_MESSAGES

export function isPlatformTeamErrorCode(value: unknown): value is PlatformTeamErrorCode {
  return typeof value === "string" && Object.hasOwn(PLATFORM_TEAM_ERROR_MESSAGES, value)
}

// ---------------------------------------------------------------------------
// Leitura defensiva das respostas do banco
// ---------------------------------------------------------------------------

type UnknownRecord = Record<string, unknown>

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null
}

function count(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isPlatformTeamId(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value)
}

export const PLATFORM_TEAM_INVITATION_STATUSES = [
  "valido",
  "expirado",
  "usado",
  "revogado",
] as const
export type PlatformTeamInvitationStatus = (typeof PLATFORM_TEAM_INVITATION_STATUSES)[number]

/** Prévia do convite: nunca traz o e-mail convidado. */
export type PlatformTeamInvitationPreview = {
  status: PlatformTeamInvitationStatus
  role: PlatformStaffRole
  expiresAt: string
  /** A conta logada tem o e-mail convidado. */
  emailMatches: boolean
  emailConfirmed: boolean
  /** A conta logada já está ativa na equipe. */
  alreadyMember: boolean
}

/** `platform_staff_invitation_preview` → prévia validada, ou null. */
export function parsePlatformTeamInvitationPreview(
  data: unknown
): PlatformTeamInvitationPreview | null {
  if (!isRecord(data)) {
    return null
  }

  const status = data.status
  const expiresAt = text(data.expires_at)

  if (
    typeof status !== "string" ||
    !(PLATFORM_TEAM_INVITATION_STATUSES as readonly string[]).includes(status) ||
    !isPlatformStaffRole(data.role) ||
    !expiresAt
  ) {
    return null
  }

  return {
    status: status as PlatformTeamInvitationStatus,
    role: data.role,
    expiresAt,
    emailMatches: data.email_matches === true,
    emailConfirmed: data.email_confirmed === true,
    alreadyMember: data.already_member === true,
  }
}

export type PlatformTeamOwner = { email: string; hasAccount: boolean }

export type PlatformTeamMember = {
  userId: string
  email: string
  role: PlatformStaffRole
  joinedAt: string
  invitedByEmail: string | null
  roleChangedAt: string | null
  /** false: a conta trocou de e-mail ou perdeu a confirmação (sem acesso). */
  accountEmailMatches: boolean
  /** O e-mail também está na lista de Donos do servidor. */
  isOwnerEmail: boolean
}

export type PlatformTeamInvitation = {
  id: string
  email: string
  role: PlatformStaffRole
  expiresAt: string
  expired: boolean
  createdAt: string
  lastSentAt: string
  sendCount: number
  invitedByEmail: string | null
}

export type PlatformTeamLimits = {
  pending: number
  maxPending: number
  sendsLast24h: number
  maxSendsPerDay: number
}

export type PlatformTeamSnapshot = {
  owners: PlatformTeamOwner[]
  members: PlatformTeamMember[]
  invitations: PlatformTeamInvitation[]
  limits: PlatformTeamLimits
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

/** `platform_staff_list` → retrato validado (linhas fora do formato são ignoradas). */
export function parsePlatformTeamSnapshot(data: unknown): PlatformTeamSnapshot | null {
  if (!isRecord(data)) {
    return null
  }

  const owners = list(data.owners).flatMap((row): PlatformTeamOwner[] => {
    const email = isRecord(row) ? text(row.email) : null
    return email && isRecord(row) ? [{ email, hasAccount: row.has_account === true }] : []
  })

  const members = list(data.members).flatMap((row): PlatformTeamMember[] => {
    if (!isRecord(row)) {
      return []
    }

    const userId = row.user_id
    const email = text(row.email)
    const joinedAt = text(row.joined_at)

    if (!isPlatformTeamId(userId) || !email || !joinedAt || !isPlatformStaffRole(row.role)) {
      return []
    }

    return [
      {
        userId,
        email,
        role: row.role,
        joinedAt,
        invitedByEmail: text(row.invited_by_email),
        roleChangedAt: text(row.role_changed_at),
        accountEmailMatches: row.account_email_matches === true,
        isOwnerEmail: row.is_owner_email === true,
      },
    ]
  })

  const invitations = list(data.invitations).flatMap((row): PlatformTeamInvitation[] => {
    if (!isRecord(row)) {
      return []
    }

    const id = row.id
    const email = text(row.email)
    const expiresAt = text(row.expires_at)
    const createdAt = text(row.created_at)

    if (
      !isPlatformTeamId(id) ||
      !email ||
      !expiresAt ||
      !createdAt ||
      !isPlatformStaffRole(row.role)
    ) {
      return []
    }

    return [
      {
        id,
        email,
        role: row.role,
        expiresAt,
        expired: row.expired === true,
        createdAt,
        lastSentAt: text(row.last_sent_at) ?? createdAt,
        sendCount: Math.max(1, count(row.send_count)),
        invitedByEmail: text(row.invited_by_email),
      },
    ]
  })

  const limits = isRecord(data.limits) ? data.limits : {}

  return {
    owners,
    members,
    invitations,
    limits: {
      pending: count(limits.pending),
      maxPending: count(limits.max_pending) || PLATFORM_TEAM_MAX_PENDING_INVITATIONS,
      sendsLast24h: count(limits.sends_last_24h),
      maxSendsPerDay: count(limits.max_sends_per_day) || PLATFORM_TEAM_MAX_SENDS_PER_DAY,
    },
  }
}

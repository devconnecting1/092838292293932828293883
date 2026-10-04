/**
 * Console da Plataforma — comunicados globais para o CRM das imobiliárias.
 *
 * Regras puras: limpeza do texto (sem HTML), link só https, período, público,
 * situação e quem vê a faixa. O banco repete as mesmas restrições
 * (public.platform_announcements) e a RLS decide o que cada sessão lê; aqui é
 * para validar o formulário, preparar a gravação e explicar na tela.
 *
 * Datas do formulário são no horário de Brasília (UTC-3 o ano todo, sem horário
 * de verão desde 2019), no formato do <input type="datetime-local">.
 */

import { z } from "zod"

export const ANNOUNCEMENT_KINDS = ["informacao", "atencao", "manutencao"] as const
export type AnnouncementKind = (typeof ANNOUNCEMENT_KINDS)[number]

export const ANNOUNCEMENT_KIND_LABELS: Record<AnnouncementKind, string> = {
  informacao: "Informação",
  atencao: "Atenção",
  manutencao: "Manutenção",
}

export const ANNOUNCEMENT_AUDIENCES = ["todos", "donos_e_gerentes"] as const
export type AnnouncementAudience = (typeof ANNOUNCEMENT_AUDIENCES)[number]

export const ANNOUNCEMENT_AUDIENCE_LABELS: Record<AnnouncementAudience, string> = {
  todos: "Todos os usuários",
  donos_e_gerentes: "Só donos e gerentes",
}

/** Papéis que veem o público "donos e gerentes" (na imobiliária aberta). */
export const ANNOUNCEMENT_LEADER_ROLES: readonly string[] = ["owner", "manager"]

export const ANNOUNCEMENT_LIMITS = {
  titleMin: 3,
  titleMax: 80,
  bodyMin: 3,
  bodyMax: 500,
  linkMax: 500,
  linkLabelMin: 2,
  linkLabelMax: 40,
  maxDurationDays: 90,
  reasonMin: 3,
  reasonMax: 1000,
} as const

export const ANNOUNCEMENT_DEFAULT_LINK_LABEL = "Saiba mais"

export type AnnouncementStatus = "agendado" | "no_ar" | "encerrado" | "vencido"

export const ANNOUNCEMENT_STATUS_LABELS: Record<AnnouncementStatus, string> = {
  agendado: "Agendado",
  no_ar: "No ar",
  encerrado: "Encerrado",
  vencido: "Terminou",
}

export function isAnnouncementKind(value: unknown): value is AnnouncementKind {
  return typeof value === "string" && (ANNOUNCEMENT_KINDS as readonly string[]).includes(value)
}

export function isAnnouncementAudience(value: unknown): value is AnnouncementAudience {
  return typeof value === "string" && (ANNOUNCEMENT_AUDIENCES as readonly string[]).includes(value)
}

// ---------------------------------------------------------------------------
// Texto e link
// ---------------------------------------------------------------------------

const ENTITIES: Record<string, string> = {
  "&nbsp;": " ",
  "&amp;": "&",
  "&quot;": '"',
  "&#39;": "'",
  "&apos;": "'",
  "&lt;": "",
  "&gt;": "",
}

/**
 * Texto puro de uma linha: tira tags HTML (e o que restar de < e >), entidades
 * comuns, caracteres de controle e de direção invisíveis, junta espaços e apara.
 * O banco recusa < > e caracteres de controle; a tela ainda escapa tudo.
 */
export function sanitizeAnnouncementText(value: unknown): string {
  if (typeof value !== "string") {
    return ""
  }

  return (
    value
      .normalize("NFC")
      .replace(/<[^>]*>/g, " ")
      .replace(
        /&(nbsp|amp|quot|#39|apos|lt|gt);/gi,
        (entity) => ENTITIES[entity.toLowerCase()] ?? ""
      )
      .replace(/[<>]/g, "")
      // Controle C0/C1 e caracteres invisíveis de largura zero e de direção do texto.
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u2069\ufeff]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
  )
}

export type AnnouncementLinkResult = { ok: true; url: string | null } | { ok: false; error: string }

/**
 * Link opcional: só https, sem usuário e senha no endereço, com domínio. Volta
 * normalizado (como o navegador abriria). Vazio = sem link.
 */
export function normalizeAnnouncementLink(value: unknown): AnnouncementLinkResult {
  const raw = typeof value === "string" ? value.trim() : ""

  if (!raw) {
    return { ok: true, url: null }
  }

  if (/[\s<>"'`\\]/.test(raw)) {
    return { ok: false, error: "O link não pode ter espaços nem aspas." }
  }

  let url: URL

  try {
    url = new URL(raw)
  } catch {
    return { ok: false, error: "Informe o endereço completo, começando com https://" }
  }

  if (url.protocol !== "https:") {
    return { ok: false, error: "Use um link seguro, começando com https://" }
  }

  if (url.username || url.password) {
    return { ok: false, error: "O link não pode ter usuário ou senha." }
  }

  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(url.hostname)) {
    return { ok: false, error: "O link precisa ter um domínio, como https://exemplo.com.br" }
  }

  const href = url.href

  if (href.length > ANNOUNCEMENT_LIMITS.linkMax) {
    return {
      ok: false,
      error: `O link pode ter até ${ANNOUNCEMENT_LIMITS.linkMax} caracteres.`,
    }
  }

  return { ok: true, url: href }
}

// ---------------------------------------------------------------------------
// Datas (horário de Brasília)
// ---------------------------------------------------------------------------

const BRASILIA_OFFSET_MS = -3 * 60 * 60 * 1000
const LOCAL_INPUT_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/

/** Data (ISO ou Date) → "AAAA-MM-DDTHH:mm" no horário de Brasília, para o campo. */
export function toBrasiliaInputValue(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value)

  if (Number.isNaN(date.getTime())) {
    return ""
  }

  return new Date(date.getTime() + BRASILIA_OFFSET_MS).toISOString().slice(0, 16)
}

/** "AAAA-MM-DDTHH:mm" no horário de Brasília → ISO (UTC); null se inválida. */
export function fromBrasiliaInputValue(value: unknown): string | null {
  if (typeof value !== "string" || !LOCAL_INPUT_PATTERN.test(value.trim())) {
    return null
  }

  const trimmed = value.trim()
  const date = new Date(`${trimmed}:00.000Z`)

  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 16) !== trimmed) {
    return null
  }

  return new Date(date.getTime() - BRASILIA_OFFSET_MS).toISOString()
}

// ---------------------------------------------------------------------------
// Formulário
// ---------------------------------------------------------------------------

export type AnnouncementFormValues = {
  title: string
  body: string
  kind: AnnouncementKind
  audience: AnnouncementAudience
  /** "AAAA-MM-DDTHH:mm", horário de Brasília. */
  startsAt: string
  endsAt: string
  linkUrl: string
  linkLabel: string
}

export type AnnouncementField = keyof AnnouncementFormValues

export type AnnouncementPayload = {
  title: string
  body: string
  kind: AnnouncementKind
  audience: AnnouncementAudience
  /** ISO (UTC). */
  startsAt: string
  endsAt: string
  linkUrl: string | null
  linkLabel: string | null
}

export type AnnouncementPreparation =
  | { ok: true; payload: AnnouncementPayload }
  | { ok: false; fieldErrors: Partial<Record<AnnouncementField, string>> }

const DAY_MS = 24 * 60 * 60 * 1000

function lengthError(label: string, value: string, min: number, max: number): string | null {
  if (value.length < min) {
    return `${label} precisa ter pelo menos ${min} caracteres.`
  }

  return value.length > max ? `${label} pode ter até ${max} caracteres.` : null
}

/**
 * Limpa e confere tudo antes de gravar. `now` decide se o fim já passou (um
 * comunicado no ar pode continuar com início no passado).
 */
export function prepareAnnouncement(
  values: Partial<Record<AnnouncementField, unknown>>,
  now: Date
): AnnouncementPreparation {
  const fieldErrors: Partial<Record<AnnouncementField, string>> = {}
  const title = sanitizeAnnouncementText(values.title)
  const body = sanitizeAnnouncementText(values.body)
  const linkLabel = sanitizeAnnouncementText(values.linkLabel)
  const link = normalizeAnnouncementLink(values.linkUrl)
  const startsAt = fromBrasiliaInputValue(values.startsAt)
  const endsAt = fromBrasiliaInputValue(values.endsAt)

  const titleError = lengthError(
    "O título",
    title,
    ANNOUNCEMENT_LIMITS.titleMin,
    ANNOUNCEMENT_LIMITS.titleMax
  )
  if (titleError) fieldErrors.title = titleError

  const bodyError = lengthError(
    "O texto",
    body,
    ANNOUNCEMENT_LIMITS.bodyMin,
    ANNOUNCEMENT_LIMITS.bodyMax
  )
  if (bodyError) fieldErrors.body = bodyError

  if (!isAnnouncementKind(values.kind)) {
    fieldErrors.kind = "Escolha o tipo do comunicado."
  }

  if (!isAnnouncementAudience(values.audience)) {
    fieldErrors.audience = "Escolha quem vê o comunicado."
  }

  if (!startsAt) {
    fieldErrors.startsAt = "Informe a data e a hora de início."
  }

  if (!endsAt) {
    fieldErrors.endsAt = "Informe a data e a hora de fim."
  } else if (Date.parse(endsAt) <= now.getTime()) {
    fieldErrors.endsAt = "O fim precisa ser no futuro."
  } else if (startsAt && Date.parse(endsAt) <= Date.parse(startsAt)) {
    fieldErrors.endsAt = "O fim precisa ser depois do início."
  } else if (
    startsAt &&
    Date.parse(endsAt) - Date.parse(startsAt) > ANNOUNCEMENT_LIMITS.maxDurationDays * DAY_MS
  ) {
    fieldErrors.endsAt = `Um comunicado fica no ar por até ${ANNOUNCEMENT_LIMITS.maxDurationDays} dias.`
  }

  if (!link.ok) {
    fieldErrors.linkUrl = link.error
  }

  const hasLink = link.ok && link.url !== null

  if (hasLink && linkLabel) {
    const labelError = lengthError(
      "O texto do link",
      linkLabel,
      ANNOUNCEMENT_LIMITS.linkLabelMin,
      ANNOUNCEMENT_LIMITS.linkLabelMax
    )
    if (labelError) fieldErrors.linkLabel = labelError
  }

  if (Object.keys(fieldErrors).length > 0 || !startsAt || !endsAt || !link.ok) {
    return { ok: false, fieldErrors }
  }

  return {
    ok: true,
    payload: {
      title,
      body,
      kind: values.kind as AnnouncementKind,
      audience: values.audience as AnnouncementAudience,
      startsAt,
      endsAt,
      linkUrl: link.url,
      linkLabel: hasLink ? linkLabel || ANNOUNCEMENT_DEFAULT_LINK_LABEL : null,
    },
  }
}

/** Esquema do formulário (mesmas regras de `prepareAnnouncement`, com o relógio do navegador). */
export const announcementFormSchema = z
  .object({
    title: z.string(),
    body: z.string(),
    kind: z.enum(ANNOUNCEMENT_KINDS),
    audience: z.enum(ANNOUNCEMENT_AUDIENCES),
    startsAt: z.string(),
    endsAt: z.string(),
    linkUrl: z.string(),
    linkLabel: z.string(),
  })
  .superRefine((values, context) => {
    const result = prepareAnnouncement(values, new Date())

    if (!result.ok) {
      for (const [field, message] of Object.entries(result.fieldErrors)) {
        if (message) {
          context.addIssue({ code: "custom", path: [field], message })
        }
      }
    }
  })

/** Motivo opcional ao encerrar: vazio ou de 3 a 1.000 caracteres. */
export function prepareAnnouncementEndReason(
  value: unknown
): { ok: true; reason: string | null } | { ok: false; error: string } {
  const reason = sanitizeAnnouncementText(value)

  if (!reason) {
    return { ok: true, reason: null }
  }

  const error = lengthError(
    "O motivo",
    reason,
    ANNOUNCEMENT_LIMITS.reasonMin,
    ANNOUNCEMENT_LIMITS.reasonMax
  )

  return error ? { ok: false, error } : { ok: true, reason }
}

// ---------------------------------------------------------------------------
// Situação e público
// ---------------------------------------------------------------------------

export type AnnouncementPeriod = {
  startsAt: string
  endsAt: string
  endedAt: string | null
}

export function announcementStatus(
  announcement: AnnouncementPeriod,
  now: Date
): AnnouncementStatus {
  if (announcement.endedAt) {
    return "encerrado"
  }

  const time = now.getTime()

  if (Date.parse(announcement.endsAt) <= time) {
    return "vencido"
  }

  return Date.parse(announcement.startsAt) > time ? "agendado" : "no_ar"
}

/** Encerrado e vencido não se editam nem se encerram de novo. */
export function isAnnouncementEditable(announcement: AnnouncementPeriod, now: Date): boolean {
  const status = announcementStatus(announcement, now)
  return status === "agendado" || status === "no_ar"
}

/**
 * A faixa filtra de novo pelo papel NA IMOBILIÁRIA ABERTA: a RLS libera "donos e
 * gerentes" para quem é dono ou gerente em alguma imobiliária.
 */
export function isAnnouncementForRole(audience: string, role: string): boolean {
  if (audience === "todos") {
    return true
  }

  return audience === "donos_e_gerentes" && ANNOUNCEMENT_LEADER_ROLES.includes(role)
}

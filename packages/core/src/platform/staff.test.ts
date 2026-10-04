import { describe, expect, it } from "vitest"

import {
  buildPlatformTeamInvitationPath,
  canActOnPlatform,
  canManagePlatformTeam,
  hasPlatformRole,
  isPlatformStaffRole,
  isPlatformTeamErrorCode,
  isPlatformTeamInvitationToken,
  normalizePlatformTeamEmail,
  parsePlatformTeamInvitationPreview,
  parsePlatformTeamSnapshot,
  PLATFORM_TEAM_ERROR_MESSAGES,
} from "./staff"

const USER_ID = "3f0c2a4e-8b1d-4c5e-9a7f-1b2c3d4e5f60"
const INVITATION_ID = "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d"

describe("papéis da equipe da plataforma", () => {
  it("Dono pode tudo, Administrador age e Somente leitura só vê", () => {
    expect(canActOnPlatform("owner")).toBe(true)
    expect(canActOnPlatform("admin")).toBe(true)
    expect(canActOnPlatform("viewer")).toBe(false)
    expect(canActOnPlatform(null)).toBe(false)

    expect(canManagePlatformTeam("owner")).toBe(true)
    expect(canManagePlatformTeam("admin")).toBe(false)
    expect(canManagePlatformTeam("viewer")).toBe(false)
  })

  it("compara o papel pelo mínimo pedido e recusa valor desconhecido", () => {
    expect(hasPlatformRole("viewer", "viewer")).toBe(true)
    expect(hasPlatformRole("viewer", "admin")).toBe(false)
    expect(hasPlatformRole("admin", "owner")).toBe(false)
    expect(hasPlatformRole("owner", "admin")).toBe(true)
    expect(hasPlatformRole("root" as never, "viewer")).toBe(false)
  })

  it("só admin e viewer são papéis de convite", () => {
    expect(isPlatformStaffRole("admin")).toBe(true)
    expect(isPlatformStaffRole("viewer")).toBe(true)
    expect(isPlatformStaffRole("owner")).toBe(false)
    expect(isPlatformStaffRole("")).toBe(false)
  })
})

describe("convite para a equipe", () => {
  it("aceita só o token de 43 caracteres em base64url", () => {
    const token = "A".repeat(42) + "_"

    expect(isPlatformTeamInvitationToken(token)).toBe(true)
    expect(isPlatformTeamInvitationToken("A".repeat(42))).toBe(false)
    expect(isPlatformTeamInvitationToken(`${"A".repeat(42)}/`)).toBe(false)
    expect(isPlatformTeamInvitationToken("../../plataforma")).toBe(false)
    expect(buildPlatformTeamInvitationPath(token)).toBe(`/convite/equipe/${token}`)
  })

  it("normaliza o e-mail como o banco e recusa formato inválido", () => {
    expect(normalizePlatformTeamEmail("  Ana.Silva@Exemplo.COM.br ")).toBe(
      "ana.silva@exemplo.com.br"
    )
    expect(normalizePlatformTeamEmail("sem-arroba")).toBeNull()
    expect(normalizePlatformTeamEmail("a@b")).toBeNull()
    expect(normalizePlatformTeamEmail("com espaço@exemplo.com")).toBeNull()
    expect(normalizePlatformTeamEmail(42)).toBeNull()
  })

  it("traduz os códigos de erro do banco", () => {
    expect(isPlatformTeamErrorCode("convite_expirado")).toBe(true)
    expect(isPlatformTeamErrorCode("toString")).toBe(false)
    expect(PLATFORM_TEAM_ERROR_MESSAGES.email_diferente).toContain("outro e-mail")
  })

  it("lê a prévia sem e-mail e recusa formato inesperado", () => {
    expect(
      parsePlatformTeamInvitationPreview({
        status: "valido",
        role: "viewer",
        expires_at: "2026-09-24T10:00:00Z",
        email_matches: true,
        email_confirmed: true,
        already_member: false,
      })
    ).toEqual({
      status: "valido",
      role: "viewer",
      expiresAt: "2026-09-24T10:00:00Z",
      emailMatches: true,
      emailConfirmed: true,
      alreadyMember: false,
    })

    expect(parsePlatformTeamInvitationPreview(null)).toBeNull()
    expect(
      parsePlatformTeamInvitationPreview({ status: "valido", role: "owner", expires_at: "x" })
    ).toBeNull()
    expect(
      parsePlatformTeamInvitationPreview({ status: "outro", role: "admin", expires_at: "x" })
    ).toBeNull()
  })
})

describe("parsePlatformTeamSnapshot", () => {
  it("lê donos, pessoas, convites e travas e ignora linhas fora do formato", () => {
    const snapshot = parsePlatformTeamSnapshot({
      owners: [{ email: "dono@exemplo.com", has_account: true }, { has_account: true }],
      members: [
        {
          user_id: USER_ID,
          email: "ana@exemplo.com",
          role: "admin",
          joined_at: "2026-09-17T10:00:00Z",
          invited_by_email: "dono@exemplo.com",
          role_changed_at: null,
          account_email_matches: true,
          is_owner_email: false,
        },
        { user_id: "nao-e-uuid", email: "x@exemplo.com", role: "admin", joined_at: "2026" },
        { user_id: USER_ID, email: "y@exemplo.com", role: "owner", joined_at: "2026" },
      ],
      invitations: [
        {
          id: INVITATION_ID,
          email: "bia@exemplo.com",
          role: "viewer",
          expires_at: "2026-09-24T10:00:00Z",
          expired: false,
          created_at: "2026-09-17T10:00:00Z",
          last_sent_at: "2026-09-17T11:00:00Z",
          send_count: 2,
          invited_by_email: "dono@exemplo.com",
        },
      ],
      limits: { pending: 1, max_pending: 20, sends_last_24h: 3, max_sends_per_day: 30 },
    })

    expect(snapshot?.owners).toEqual([{ email: "dono@exemplo.com", hasAccount: true }])
    expect(snapshot?.members).toHaveLength(1)
    expect(snapshot?.members[0]).toMatchObject({ userId: USER_ID, role: "admin" })
    expect(snapshot?.invitations[0]).toMatchObject({ id: INVITATION_ID, sendCount: 2 })
    expect(snapshot?.limits).toEqual({
      pending: 1,
      maxPending: 20,
      sendsLast24h: 3,
      maxSendsPerDay: 30,
    })
  })

  it("devolve null para resposta que não é objeto", () => {
    expect(parsePlatformTeamSnapshot([])).toBeNull()
    expect(parsePlatformTeamSnapshot("x")).toBeNull()
  })
})

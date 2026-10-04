import { describe, expect, it } from "vitest"

import { platformTeamInvitationEmail, platformTeamNoticeEmail } from "./platform-team-templates"
import { EmailTemplateError } from "./templates"

const ORIGIN = "https://seucrm.com.br"
const TOKEN = "AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-abcde"

function invitation(overrides: Partial<Parameters<typeof platformTeamInvitationEmail>[0]> = {}) {
  return platformTeamInvitationEmail({
    origin: ORIGIN,
    invitationUrl: `/convite/equipe/${TOKEN}`,
    role: "viewer",
    inviterEmail: "Dono@Exemplo.com",
    expiresAt: "2026-09-24T13:00:00Z",
    ...overrides,
  })
}

describe("platformTeamInvitationEmail", () => {
  it("traz o papel, quem convidou, a validade e o link preso à origem", () => {
    const email = invitation()

    expect(email.subject).toBe("Convite para a equipe da plataforma CRM Imobiliário")
    expect(email.text).toContain("dono@exemplo.com convidou você")
    expect(email.text).toContain("papel Somente leitura")
    expect(email.text).toContain("Válido até: 24 de setembro de 2026 às 10:00")
    expect(email.html).toContain(`href="https://seucrm.com.br/convite/equipe/${TOKEN}"`)
    expect(email.text).toContain("vale uma vez só")
  })

  it("descreve o papel de Administrador", () => {
    const email = invitation({ role: "admin", inviterEmail: null })

    expect(email.text).toContain("O Dono da plataforma convidou você")
    expect(email.text).toContain("não gerencia a equipe")
  })

  it("não monta com origem, link ou papel inválidos", () => {
    expect(() => invitation({ origin: "javascript:alert(1)" })).toThrow(EmailTemplateError)
    expect(() => invitation({ invitationUrl: "javascript:alert(1)" })).toThrow(EmailTemplateError)
    expect(() => invitation({ role: "owner" as never })).toThrow(EmailTemplateError)
  })

  it("escapa HTML vindo de fora", () => {
    const email = invitation({ inviterEmail: "<script>@x.com" })

    expect(email.html).not.toContain("<script>")
  })
})

describe("platformTeamNoticeEmail", () => {
  const base = {
    origin: ORIGIN,
    memberEmail: "ana@exemplo.com",
    occurredAt: "2026-09-17T13:00:00Z",
  } as const

  it("avisa quem entrou e com qual papel", () => {
    const email = platformTeamNoticeEmail({ ...base, kind: "joined", role: "admin" })

    expect(email.subject).toBe("ana@exemplo.com entrou na equipe da plataforma como Administrador")
    expect(email.html).toContain('href="https://seucrm.com.br/plataforma/equipe"')
    expect(email.text).toContain("PLATFORM_ADMIN_EMAILS")
  })

  it("avisa a mudança de papel com antes, depois e quem mudou", () => {
    const email = platformTeamNoticeEmail({
      ...base,
      kind: "role_changed",
      role: "viewer",
      previousRole: "admin",
      actorEmail: "dono@exemplo.com",
    })

    expect(email.subject).toBe("ana@exemplo.com agora é Somente leitura na equipe da plataforma")
    expect(email.text).toContain("de Administrador para Somente leitura")
    expect(email.text).toContain("Alterado por: dono@exemplo.com")
  })

  it("avisa a remoção (por um Dono ou pela própria pessoa)", () => {
    const removed = platformTeamNoticeEmail({
      ...base,
      kind: "removed",
      role: "viewer",
      actorEmail: "dono@exemplo.com",
    })
    const left = platformTeamNoticeEmail({
      ...base,
      kind: "removed",
      role: "admin",
      actorEmail: "ana@exemplo.com",
    })

    expect(removed.subject).toBe("ana@exemplo.com saiu da equipe da plataforma")
    expect(removed.text).toContain("dono@exemplo.com removeu ana@exemplo.com")
    expect(left.text).toContain("ana@exemplo.com saiu da equipe")
  })

  it("não monta com e-mail da pessoa inválido", () => {
    expect(() =>
      platformTeamNoticeEmail({ ...base, kind: "joined", role: "admin", memberEmail: "x" })
    ).toThrow(EmailTemplateError)
  })
})

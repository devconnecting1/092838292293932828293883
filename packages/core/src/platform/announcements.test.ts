import { describe, expect, it } from "vitest"

import {
  ANNOUNCEMENT_DEFAULT_LINK_LABEL,
  announcementFormSchema,
  announcementStatus,
  fromBrasiliaInputValue,
  isAnnouncementEditable,
  isAnnouncementForRole,
  normalizeAnnouncementLink,
  prepareAnnouncement,
  prepareAnnouncementEndReason,
  sanitizeAnnouncementText,
  toBrasiliaInputValue,
  type AnnouncementFormValues,
} from "./announcements"

const NOW = new Date("2026-09-17T15:00:00Z") // 12:00 em Brasília

const VALID: AnnouncementFormValues = {
  title: "Manutenção no domingo",
  body: "O CRM fica fora do ar das 2h às 3h.",
  kind: "manutencao",
  audience: "todos",
  startsAt: "2026-09-17T12:00",
  endsAt: "2026-09-21T03:00",
  linkUrl: "",
  linkLabel: "",
}

describe("sanitizeAnnouncementText", () => {
  it("tira HTML, entidades e caracteres invisíveis", () => {
    expect(sanitizeAnnouncementText("<b>Novo</b> recurso <script>alert(1)</script>")).toBe(
      "Novo recurso alert(1)"
    )
    expect(sanitizeAnnouncementText("a &lt;b&gt; &amp; c&nbsp;d")).toBe("a b & c d")
    expect(sanitizeAnnouncementText("linha 1\nlinha 2\t\u0007fim\u202e")).toBe(
      "linha 1 linha 2 fim"
    )
    expect(sanitizeAnnouncementText("preço < 100")).toBe("preço 100")
    expect(sanitizeAnnouncementText(42)).toBe("")
  })
})

describe("normalizeAnnouncementLink", () => {
  it("aceita só https com domínio", () => {
    expect(normalizeAnnouncementLink("")).toEqual({ ok: true, url: null })
    expect(normalizeAnnouncementLink(" https://exemplo.com.br/novidades?x=1 ")).toEqual({
      ok: true,
      url: "https://exemplo.com.br/novidades?x=1",
    })
    expect(normalizeAnnouncementLink("http://exemplo.com.br").ok).toBe(false)
    expect(normalizeAnnouncementLink("javascript:alert(1)").ok).toBe(false)
    expect(normalizeAnnouncementLink("https://usuario:senha@exemplo.com.br").ok).toBe(false)
    expect(normalizeAnnouncementLink("https://localhost/x").ok).toBe(false)
    expect(normalizeAnnouncementLink('https://exemplo.com.br/"onmouseover').ok).toBe(false)
    expect(normalizeAnnouncementLink("exemplo.com.br").ok).toBe(false)
    expect(normalizeAnnouncementLink(`https://exemplo.com.br/${"a".repeat(500)}`).ok).toBe(false)
  })
})

describe("datas em horário de Brasília", () => {
  it("ida e volta", () => {
    expect(fromBrasiliaInputValue("2026-09-20T14:00")).toBe("2026-09-20T17:00:00.000Z")
    expect(toBrasiliaInputValue("2026-09-20T17:00:00.000Z")).toBe("2026-09-20T14:00")
    expect(toBrasiliaInputValue(new Date("2026-01-01T02:30:00Z"))).toBe("2025-12-31T23:30")
  })

  it("recusa data inexistente ou fora do formato", () => {
    expect(fromBrasiliaInputValue("2026-02-31T10:00")).toBeNull()
    expect(fromBrasiliaInputValue("20/09/2026 14:00")).toBeNull()
    expect(fromBrasiliaInputValue(undefined)).toBeNull()
    expect(toBrasiliaInputValue("nada")).toBe("")
  })
})

describe("prepareAnnouncement", () => {
  it("limpa e converte para gravar", () => {
    const result = prepareAnnouncement(
      {
        ...VALID,
        title: "  <i>Manutenção</i>   no domingo ",
        linkUrl: "https://exemplo.com.br/status",
      },
      NOW
    )

    expect(result).toEqual({
      ok: true,
      payload: {
        title: "Manutenção no domingo",
        body: "O CRM fica fora do ar das 2h às 3h.",
        kind: "manutencao",
        audience: "todos",
        startsAt: "2026-09-17T15:00:00.000Z",
        endsAt: "2026-09-21T06:00:00.000Z",
        linkUrl: "https://exemplo.com.br/status",
        linkLabel: ANNOUNCEMENT_DEFAULT_LINK_LABEL,
      },
    })
  })

  it("sem link, o texto do link é descartado", () => {
    const result = prepareAnnouncement({ ...VALID, linkLabel: "Abrir" }, NOW)
    expect(result.ok && result.payload.linkLabel).toBeNull()
  })

  it("aponta cada campo inválido", () => {
    const result = prepareAnnouncement(
      {
        title: "<b></b>ab",
        body: "x".repeat(501),
        kind: "promocao",
        audience: "corretores",
        startsAt: "amanhã",
        endsAt: "2026-09-17T11:59",
        linkUrl: "http://exemplo.com.br",
        linkLabel: "",
      },
      NOW
    )

    expect(result.ok).toBe(false)
    expect(result.ok ? {} : result.fieldErrors).toEqual({
      title: "O título precisa ter pelo menos 3 caracteres.",
      body: "O texto pode ter até 500 caracteres.",
      kind: "Escolha o tipo do comunicado.",
      audience: "Escolha quem vê o comunicado.",
      startsAt: "Informe a data e a hora de início.",
      endsAt: "O fim precisa ser no futuro.",
      linkUrl: "Use um link seguro, começando com https://",
    })
  })

  it("fim antes do início e mais de 90 dias", () => {
    const before = prepareAnnouncement(
      { ...VALID, startsAt: "2026-09-20T10:00", endsAt: "2026-09-20T09:00" },
      NOW
    )
    expect(before.ok ? null : before.fieldErrors.endsAt).toBe("O fim precisa ser depois do início.")

    const tooLong = prepareAnnouncement({ ...VALID, endsAt: "2026-12-17T12:01" }, NOW)
    expect(tooLong.ok ? null : tooLong.fieldErrors.endsAt).toContain("até 90 dias")
  })

  it("comunicado no ar pode manter o início no passado", () => {
    expect(prepareAnnouncement({ ...VALID, startsAt: "2026-09-01T08:00" }, NOW).ok).toBe(true)
  })

  it("o esquema do formulário usa as mesmas regras", () => {
    const parsed = announcementFormSchema.safeParse({
      ...VALID,
      title: "a",
      endsAt: "2099-01-01T00:00",
      startsAt: "2098-12-31T00:00",
    })
    expect(parsed.success).toBe(false)
    expect(parsed.error?.issues.map((issue) => issue.path.join("."))).toEqual(["title"])
  })
})

describe("motivo ao encerrar", () => {
  it("opcional, mas com tamanho mínimo", () => {
    expect(prepareAnnouncementEndReason("   ")).toEqual({ ok: true, reason: null })
    expect(prepareAnnouncementEndReason("ok")).toEqual({
      ok: false,
      error: "O motivo precisa ter pelo menos 3 caracteres.",
    })
    expect(prepareAnnouncementEndReason(" Publicado <b>por engano</b> ")).toEqual({
      ok: true,
      reason: "Publicado por engano",
    })
  })
})

describe("situação e público", () => {
  const base = {
    startsAt: "2026-09-17T14:00:00Z",
    endsAt: "2026-09-18T14:00:00Z",
    endedAt: null,
  }

  it("agendado, no ar, terminou e encerrado", () => {
    expect(announcementStatus(base, NOW)).toBe("no_ar")
    expect(announcementStatus({ ...base, startsAt: "2026-09-17T16:00:00Z" }, NOW)).toBe("agendado")
    expect(announcementStatus({ ...base, endsAt: "2026-09-17T15:00:00Z" }, NOW)).toBe("vencido")
    expect(announcementStatus({ ...base, endedAt: "2026-09-17T14:30:00Z" }, NOW)).toBe("encerrado")
    expect(isAnnouncementEditable(base, NOW)).toBe(true)
    expect(isAnnouncementEditable({ ...base, endedAt: "2026-09-17T14:30:00Z" }, NOW)).toBe(false)
  })

  it("donos e gerentes só para quem tem esse papel na imobiliária aberta", () => {
    expect(isAnnouncementForRole("todos", "broker")).toBe(true)
    expect(isAnnouncementForRole("donos_e_gerentes", "owner")).toBe(true)
    expect(isAnnouncementForRole("donos_e_gerentes", "manager")).toBe(true)
    expect(isAnnouncementForRole("donos_e_gerentes", "broker")).toBe(false)
    expect(isAnnouncementForRole("desconhecido", "owner")).toBe(false)
  })
})

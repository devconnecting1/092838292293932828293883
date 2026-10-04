import { describe, expect, it, vi } from "vitest"

import {
  DEFAULT_EMAIL_DAILY_LIMIT,
  emailDailyReserve,
  emailFailureLabel,
  emailKindLabel,
  emailPriorityCeiling,
  emailPriorityForKind,
  parseEmailDailyLimit,
  sendWithinEmailQuota,
  summarizeEmailQuota,
  type EmailQuotaReservation,
} from "./quota"

describe("emailPriorityForKind", () => {
  it("segue a ordem combinada: lead, convite, lembrete, alertas, resumo, relatório", () => {
    expect(emailPriorityForKind("new_lead")).toBe(1)
    expect(emailPriorityForKind("lead_sla_notice")).toBe(1)
    expect(emailPriorityForKind("team_invitation")).toBe(2)
    expect(emailPriorityForKind("platform_team_invitation")).toBe(2)
    expect(emailPriorityForKind("visit_reminder")).toBe(3)
    expect(emailPriorityForKind("visit_assigned")).toBe(3)
    expect(emailPriorityForKind("subscription_notice")).toBe(4)
    expect(emailPriorityForKind("authorization_expiring")).toBe(4)
    expect(emailPriorityForKind("daily_digest")).toBe(5)
    expect(emailPriorityForKind("weekly_report")).toBe(6)
  })

  it("tipo desconhecido não entra na reserva de lead", () => {
    expect(emailPriorityForKind("qualquer_coisa")).toBe(4)
    expect(emailPriorityForKind("__proto__")).toBe(4)
  })
})

describe("tetos por classe", () => {
  it("com 300/dia: 300, 300, 225, 210, 150 e 120", () => {
    expect([1, 2, 3, 4, 5, 6].map((p) => emailPriorityCeiling(300, p as 1))).toEqual([
      300, 300, 225, 210, 150, 120,
    ])
    expect(emailDailyReserve(300)).toBe(75)
  })

  it("resumo e relatório nunca consomem a cota inteira, em qualquer limite", () => {
    for (const limit of [1, 2, 10, 300, 1000, 100_000]) {
      expect(emailPriorityCeiling(limit, 5)).toBeLessThan(emailPriorityCeiling(limit, 1))
      expect(emailPriorityCeiling(limit, 6)).toBeLessThan(emailPriorityCeiling(limit, 1))
      expect(emailPriorityCeiling(limit, 6)).toBeLessThanOrEqual(emailPriorityCeiling(limit, 5))
      expect(emailPriorityCeiling(limit, 1)).toBeGreaterThanOrEqual(1)
    }
  })

  it("limite inválido usa o padrão", () => {
    expect(emailPriorityCeiling(Number.NaN, 1)).toBe(DEFAULT_EMAIL_DAILY_LIMIT)
    expect(emailPriorityCeiling(0, 5)).toBe(150)
  })
})

describe("parseEmailDailyLimit", () => {
  it("aceita inteiro positivo e cai no padrão com lixo", () => {
    expect(parseEmailDailyLimit("20000")).toBe(20_000)
    expect(parseEmailDailyLimit(" 300 ")).toBe(300)
    expect(parseEmailDailyLimit(undefined)).toBe(300)
    expect(parseEmailDailyLimit("")).toBe(300)
    expect(parseEmailDailyLimit("0")).toBe(300)
    expect(parseEmailDailyLimit("-5")).toBe(300)
    expect(parseEmailDailyLimit("1e6")).toBe(300)
  })
})

describe("summarizeEmailQuota", () => {
  it("soma o uso e diz quais classes já pararam", () => {
    const summary = summarizeEmailQuota(300, [
      { priority: 1, reserved: 0, sent: 40, failed: 1, denied: 0 },
      { priority: 5, reserved: 2, sent: 118, failed: 0, denied: 7 },
    ])

    expect(summary).toMatchObject({ limit: 300, used: 160, free: 140, reserve: 75, denied: 7 })
    expect(summary.blocked).toEqual([5, 6])
  })
})

describe("rótulos", () => {
  it("traduz tipo e motivo sem inventar", () => {
    expect(emailKindLabel("new_lead")).toBe("Aviso de lead novo")
    expect(emailKindLabel("desconhecido")).toBe("Outro aviso")
    expect(emailFailureLabel("daily_quota")).toBe("cota diária de e-mails acabou")
    expect(emailFailureLabel("constructor")).toBe("falha no envio")
  })
})

describe("sendWithinEmailQuota", () => {
  function setup(reservation: EmailQuotaReservation | Error, sendResult = { ok: true } as const) {
    const reserve = vi.fn(async () => {
      if (reservation instanceof Error) {
        throw reservation
      }
      return reservation
    })
    const send = vi.fn(async () => sendResult as { ok: boolean; reason?: string })
    const settle = vi.fn(async () => undefined)
    return { reserve, send, settle }
  }

  it("reserva com o teto da classe, envia e confirma", async () => {
    const deps = setup({ status: "reserved", day: "2026-09-17" })
    const result = await sendWithinEmailQuota({ kind: "daily_digest", dailyLimit: 300, ...deps })

    expect(result).toEqual({ ok: true })
    expect(deps.reserve).toHaveBeenCalledWith({ priority: 5, ceiling: 150 })
    expect(deps.settle).toHaveBeenCalledWith({
      day: "2026-09-17",
      priority: 5,
      sent: true,
      reason: null,
    })
  })

  it("negado pela cota: não chama o provedor", async () => {
    const deps = setup({ status: "denied" })
    const result = await sendWithinEmailQuota({ kind: "weekly_report", dailyLimit: 300, ...deps })

    expect(result).toEqual({ ok: false, reason: "daily_quota" })
    expect(deps.send).not.toHaveBeenCalled()
    expect(deps.settle).not.toHaveBeenCalled()
  })

  it("falha do provedor devolve a reserva com o motivo", async () => {
    const deps = setup({ status: "reserved", day: "2026-09-17" }, {
      ok: false,
      reason: "rate_limited",
    } as never)
    const result = await sendWithinEmailQuota({ kind: "new_lead", dailyLimit: 300, ...deps })

    expect(result).toEqual({ ok: false, reason: "rate_limited" })
    expect(deps.settle).toHaveBeenCalledWith({
      day: "2026-09-17",
      priority: 1,
      sent: false,
      reason: "rate_limited",
    })
  })

  it("motivo fora da lista do banco vira provider_error", async () => {
    const deps = setup({ status: "reserved", day: "2026-09-17" }, {
      ok: false,
      reason: "coisa_nova",
    } as never)
    await sendWithinEmailQuota({ kind: "new_lead", dailyLimit: 300, ...deps })

    expect(deps.settle).toHaveBeenCalledWith(expect.objectContaining({ reason: "provider_error" }))
  })

  it("sem contador: lead ainda sai; resumo e relatório esperam", async () => {
    const lead = setup(new Error("rede"))
    expect(await sendWithinEmailQuota({ kind: "new_lead", dailyLimit: 300, ...lead })).toEqual({
      ok: true,
    })
    expect(lead.settle).not.toHaveBeenCalled()

    const digest = setup({ status: "unavailable" })
    expect(
      await sendWithinEmailQuota({ kind: "daily_digest", dailyLimit: 300, ...digest })
    ).toEqual({ ok: false, reason: "daily_quota" })
    expect(digest.send).not.toHaveBeenCalled()
  })

  it("confirmação que falha não muda o resultado do envio", async () => {
    const deps = setup({ status: "reserved", day: "2026-09-17" })
    deps.settle.mockRejectedValueOnce(new Error("banco"))

    expect(await sendWithinEmailQuota({ kind: "new_lead", dailyLimit: 300, ...deps })).toEqual({
      ok: true,
    })
  })
})

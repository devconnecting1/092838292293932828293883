import { describe, expect, it } from "vitest"

import {
  isSensitiveAuditKey,
  maskPersonalText,
  preparePlatformAuditEvent,
  sanitizePlatformAuditData,
} from "./audit"

const ORG = "3f2504e0-4f89-41d3-9a0c-0305e82c3301"

describe("isSensitiveAuditKey", () => {
  it("reconhece campos de dado pessoal e segredo em vários formatos", () => {
    for (const key of [
      "email",
      "ownerEmail",
      "e_mail",
      "telefone",
      "phone_number",
      "whatsapp",
      "cpf",
      "endereco",
      "feed_token",
      "senha",
      "contact_name",
      "nomeCliente",
      "lead_name",
    ]) {
      expect(isSensitiveAuditKey(key), key).toBe(true)
    }
  })

  it("deixa passar campos de negócio", () => {
    for (const key of ["plan_key", "status", "name", "organization_name", "seats", "lead_id"]) {
      expect(isSensitiveAuditKey(key), key).toBe(false)
    }
  })
})

describe("maskPersonalText", () => {
  it("tira e-mail, telefone e CPF de textos", () => {
    expect(maskPersonalText("contato fulano@exemplo.com pediu")).toBe("contato [e-mail] pediu")
    expect(maskPersonalText("ligar para (11) 98765-4321")).toBe("ligar para [número]")
    expect(maskPersonalText("CPF 123.456.789-09")).toBe("CPF [número]")
    expect(maskPersonalText("+55 11 98765 4321")).toBe("[número]")
  })

  it("mantém datas, uuids e números curtos", () => {
    expect(maskPersonalText("2026-09-17T03:36:42.123Z")).toBe("2026-09-17T03:36:42.123Z")
    expect(maskPersonalText(`imobiliária ${ORG}`)).toBe(`imobiliária ${ORG}`)
    expect(maskPersonalText("12345678-1234-1234-1234-123456789012")).toBe(
      "12345678-1234-1234-1234-123456789012"
    )
    expect(maskPersonalText("5 usuários, R$ 149,90")).toBe("5 usuários, R$ 149,90")
    expect(maskPersonalText("sub_1PzXk2AbCdEf")).toBe("sub_1PzXk2AbCdEf")
  })
})

describe("sanitizePlatformAuditData", () => {
  it("remove campos pessoais, mascara textos e mantém o resto", () => {
    const result = sanitizePlatformAuditData({
      status: "active",
      seats: 5,
      bloqueada: true,
      email: "dono@imobiliaria.com",
      owner: { phone: "11987654321", name: "Imobiliária Centro", nota: "falar com a@b.com" },
      lista: [1, "2026-09-17", { cpf: "12345678909" }],
      vazio: null,
      funcao: () => 1,
      quando: new Date("2026-09-17T12:00:00Z"),
    })

    expect(result).toEqual({
      status: "active",
      seats: 5,
      bloqueada: true,
      email: "[removido]",
      owner: { phone: "[removido]", name: "Imobiliária Centro", nota: "falar com [e-mail]" },
      lista: [1, "2026-09-17", { cpf: "[removido]" }],
      vazio: null,
      quando: "2026-09-17T12:00:00.000Z",
    })
    expect(JSON.stringify(result)).not.toMatch(/@|98765|12345678909/)
  })

  it("corta profundidade, listas e textos longos", () => {
    const deep = { a: { b: { c: { d: { e: { f: { g: { h: { i: 1 } } } } } } } } }
    expect(JSON.stringify(sanitizePlatformAuditData(deep))).toContain("[omitido]")

    const list = sanitizePlatformAuditData({ itens: Array.from({ length: 80 }, (_, i) => i) })
    expect((list?.itens as unknown[]).length).toBe(50)

    const text = sanitizePlatformAuditData({ texto: "x".repeat(900) })
    expect((text?.texto as string).length).toBe(501)
  })

  it("sem dado volta null", () => {
    expect(sanitizePlatformAuditData(null)).toBeNull()
    expect(sanitizePlatformAuditData(undefined)).toBeNull()
  })
})

describe("preparePlatformAuditEvent", () => {
  it("aceita uma ação completa e limpa o antes/depois", () => {
    const result = preparePlatformAuditEvent({
      action: "organizacao.bloquear",
      target: { type: "organizacao", id: ORG },
      organizationId: ORG.toUpperCase(),
      reason: "  Pedido do dono fulano@exemplo.com  ",
      before: { bloqueada: false },
      after: { bloqueada: true, email: "x@y.com" },
    })

    expect(result).toEqual({
      ok: true,
      payload: {
        action: "organizacao.bloquear",
        targetType: "organizacao",
        targetId: ORG,
        organizationId: ORG,
        reason: "Pedido do dono [e-mail]",
        before: { bloqueada: false },
        after: { bloqueada: true, email: "[removido]" },
      },
    })
  })

  it("recusa formatos inválidos", () => {
    expect(preparePlatformAuditEvent({ action: "Bloquear Imobiliária" })).toEqual({
      ok: false,
      reason: "acao_invalida",
    })
    expect(preparePlatformAuditEvent({ action: "a.b.c.d.e" })).toEqual({
      ok: false,
      reason: "acao_invalida",
    })
    expect(
      preparePlatformAuditEvent({ action: "organizacao.bloquear", target: { type: "Org X" } })
    ).toEqual({ ok: false, reason: "alvo_invalido" })
    expect(
      preparePlatformAuditEvent({ action: "organizacao.bloquear", organizationId: "123" })
    ).toEqual({ ok: false, reason: "imobiliaria_invalida" })
    expect(preparePlatformAuditEvent({ action: "organizacao.bloquear", reason: "ok" })).toEqual({
      ok: false,
      reason: "motivo_invalido",
    })
  })

  it("recusa antes/depois acima de 16 KB", () => {
    const big = Object.fromEntries(
      Array.from({ length: 100 }, (_, i) => [`campo_${i}`, "x".repeat(400)])
    )

    expect(preparePlatformAuditEvent({ action: "sistema.teste", after: big })).toEqual({
      ok: false,
      reason: "dados_grandes_demais",
    })
  })

  it("ação sem alvo nem motivo é válida", () => {
    const result = preparePlatformAuditEvent({ action: "sistema.recalcular" })
    expect(result.ok).toBe(true)
  })
})

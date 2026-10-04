import { describe, expect, it } from "vitest"

import { classifyBrevoResponse, normalizeEmailTags, readBrevoErrorCode } from "./delivery"

describe("classifyBrevoResponse", () => {
  it("2xx é enviado, com messageId quando vier", () => {
    expect(classifyBrevoResponse(201, { messageId: "<abc@smtp-relay>" })).toEqual({
      kind: "sent",
      messageId: "<abc@smtp-relay>",
    })
    expect(classifyBrevoResponse(202, null)).toEqual({ kind: "sent", messageId: null })
  })

  it("idempotencyKey repetido conta como já enviado", () => {
    expect(classifyBrevoResponse(400, { code: "duplicate_parameter", message: "x" })).toEqual({
      kind: "duplicate",
    })
  })

  it("mapeia 400, 401, 402, 403 e 429", () => {
    expect(
      classifyBrevoResponse(400, { code: "invalid_parameter", message: "email is not valid in to" })
    ).toEqual({ kind: "failed", reason: "invalid_recipient" })
    expect(
      classifyBrevoResponse(400, { code: "invalid_parameter", message: "htmlContent is missing" })
    ).toEqual({ kind: "failed", reason: "provider_error" })
    expect(classifyBrevoResponse(401, { code: "unauthorized" })).toEqual({
      kind: "failed",
      reason: "not_configured",
    })
    expect(classifyBrevoResponse(403, {})).toEqual({ kind: "failed", reason: "not_configured" })
    expect(classifyBrevoResponse(402, { code: "not_enough_credits" })).toEqual({
      kind: "failed",
      reason: "rate_limited",
    })
    expect(classifyBrevoResponse(429, {})).toEqual({ kind: "failed", reason: "rate_limited" })
    expect(classifyBrevoResponse(404, {})).toEqual({ kind: "failed", reason: "provider_error" })
  })

  it("5xx pede nova tentativa", () => {
    expect(classifyBrevoResponse(500, null)).toEqual({ kind: "retry" })
    expect(classifyBrevoResponse(503, "Service Unavailable")).toEqual({ kind: "retry" })
  })
})

describe("readBrevoErrorCode", () => {
  it("só devolve códigos simples, seguros para log", () => {
    expect(readBrevoErrorCode({ code: "invalid_parameter" })).toBe("invalid_parameter")
    expect(readBrevoErrorCode({ code: "maria@exemplo.com" })).toBeNull()
    expect(readBrevoErrorCode("texto")).toBeNull()
  })
})

describe("normalizeEmailTags", () => {
  it("normaliza, remove repetidas e limita a quantidade", () => {
    expect(normalizeEmailTags(["CRM", "new_lead", "crm", " Novo Lead! ", 42])).toEqual([
      "crm",
      "new_lead",
      "novo-lead",
    ])
    expect(normalizeEmailTags(Array.from({ length: 20 }, (_, i) => `t${i}`))).toHaveLength(10)
    expect(normalizeEmailTags("crm")).toEqual([])
  })
})

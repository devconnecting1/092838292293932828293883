import { describe, expect, it } from "vitest"

import {
  buildProposalSharePath,
  clampProposalShareDays,
  isProposalShareActive,
  isProposalShareToken,
  PROPOSAL_SHARE_DEFAULT_DAYS,
  PROPOSAL_SHARE_PATH_PREFIX,
} from "./share"

const TOKEN = "a".repeat(48)

describe("isProposalShareToken", () => {
  it("aceita só 48 dígitos hexadecimais minúsculos", () => {
    expect(isProposalShareToken(TOKEN)).toBe(true)
    expect(isProposalShareToken("0123456789abcdef".repeat(3))).toBe(true)
    expect(isProposalShareToken("A".repeat(48))).toBe(false)
    expect(isProposalShareToken("a".repeat(47))).toBe(false)
    expect(isProposalShareToken("a".repeat(49))).toBe(false)
    expect(isProposalShareToken("../../etc/passwd")).toBe(false)
    expect(isProposalShareToken(null)).toBe(false)
    expect(isProposalShareToken(undefined)).toBe(false)
  })
})

describe("clampProposalShareDays", () => {
  it("mantém a faixa aceita pela RPC (1 a 180 dias)", () => {
    expect(clampProposalShareDays(30)).toBe(30)
    expect(clampProposalShareDays(0)).toBe(1)
    expect(clampProposalShareDays(-5)).toBe(1)
    expect(clampProposalShareDays(9000)).toBe(180)
    expect(clampProposalShareDays(7.4)).toBe(7)
  })

  it("cai no padrão para valor ausente ou inválido", () => {
    expect(clampProposalShareDays(null)).toBe(PROPOSAL_SHARE_DEFAULT_DAYS)
    expect(clampProposalShareDays(undefined)).toBe(PROPOSAL_SHARE_DEFAULT_DAYS)
    expect(clampProposalShareDays(Number.NaN)).toBe(PROPOSAL_SHARE_DEFAULT_DAYS)
  })
})

describe("buildProposalSharePath", () => {
  it("monta o caminho público", () => {
    expect(buildProposalSharePath(TOKEN)).toBe(`${PROPOSAL_SHARE_PATH_PREFIX}/${TOKEN}`)
  })

  it("lança em token inválido em vez de gerar um link quebrado", () => {
    expect(() => buildProposalSharePath("x")).toThrow()
  })
})

describe("isProposalShareActive", () => {
  const now = new Date("2026-09-16T12:00:00Z")

  it("vale enquanto a validade não passou", () => {
    expect(isProposalShareActive({ token: TOKEN, expiresAt: "2026-09-17T12:00:00Z" }, now)).toBe(
      true
    )
  })

  it("não vale sem token, vencido ou com data inválida", () => {
    expect(isProposalShareActive({ token: null, expiresAt: "2026-09-17T12:00:00Z" }, now)).toBe(
      false
    )
    expect(isProposalShareActive({ token: TOKEN, expiresAt: "2026-09-15T12:00:00Z" }, now)).toBe(
      false
    )
    expect(isProposalShareActive({ token: TOKEN, expiresAt: null }, now)).toBe(false)
    expect(isProposalShareActive({ token: TOKEN, expiresAt: "ontem" }, now)).toBe(false)
    expect(isProposalShareActive(null, now)).toBe(false)
  })
})

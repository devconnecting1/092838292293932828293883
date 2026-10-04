import { describe, expect, it } from "vitest"

import {
  CONNECTION_HEALTH_HINTS,
  CONNECTION_HEALTH_LABELS,
  connectionHealth,
  type ConnectionHealth,
} from "./status"

const HEALTHS: readonly ConnectionHealth[] = [
  "not_connected",
  "pending",
  "active",
  "paused",
  "blocked",
  "error",
  "revoked",
]

describe("textos da situação da conexão", () => {
  it("toda situação tem selo e frase", () => {
    for (const health of HEALTHS) {
      expect(CONNECTION_HEALTH_LABELS[health].length).toBeGreaterThan(0)
      expect(CONNECTION_HEALTH_HINTS[health].length).toBeGreaterThan(0)
    }
  })

  it("conta ativa diz só que está conectada, sem prometer envio, recebimento ou atendimento", () => {
    const health = connectionHealth({ status: "connected", enabled: true, blockedAt: null })
    const hint = CONNECTION_HEALTH_HINTS[health]

    expect(health).toBe("active")
    expect(hint).toContain("conectada")
    expect(hint).not.toMatch(/envi|receb|atend|conversa|normalmente/i)
  })

  it("conta desligada não sugere que, ligada, a plataforma receberia mensagens", () => {
    const hint = CONNECTION_HEALTH_HINTS.paused

    expect(hint).toContain("conectada")
    expect(hint).not.toMatch(/receb/i)
  })
})

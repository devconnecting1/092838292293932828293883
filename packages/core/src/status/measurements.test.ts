import { describe, expect, it } from "vitest"

import {
  describeMeasurementDetail,
  describeProbeResult,
  STATUS_COMPONENT_RULES,
  STATUS_PROBE_SETUP_SQL,
} from "./measurements"
import { STATUS_COMPONENT_KEYS } from "./public"

describe("regras e rótulos das medições", () => {
  it("toda parte tem a regra explicada", () => {
    for (const key of STATUS_COMPONENT_KEYS) {
      expect(STATUS_COMPONENT_RULES[key].length).toBeGreaterThan(20)
    }
  })

  it("descreve os códigos gravados pelo banco", () => {
    expect(describeMeasurementDetail("http_503")).toBe("Resposta HTTP 503")
    expect(describeMeasurementDetail("auth_fora")).toBe("Auth do Supabase não respondeu")
    expect(describeMeasurementDetail("codigo_novo")).toBe("codigo_novo")
    expect(describeMeasurementDetail(null)).toBeNull()
  })

  it("descreve o resultado da sonda", () => {
    expect(describeProbeResult(null)).toBe("Nenhuma sonda enviada ainda.")
    expect(describeProbeResult("sem_url")).toContain("status_probe_url")
  })

  it("SQL de exemplo usa só marcador, nunca um endereço real", () => {
    expect(STATUS_PROBE_SETUP_SQL).toContain("<seu-dominio>")
    expect(STATUS_PROBE_SETUP_SQL).toContain("'status_probe_url'")
  })
})

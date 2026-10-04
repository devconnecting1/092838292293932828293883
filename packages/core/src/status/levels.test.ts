import { describe, expect, it } from "vitest"

import {
  applyStatusHysteresis,
  componentStatusLevel,
  INCIDENT_IMPACT_LEVEL,
  isAvailableLevel,
  isStatusComponentKey,
  isStatusLevel,
  overallStatusLevel,
  STATUS_LEVEL_RANK,
  worseStatusLevel,
  worstStatusLevel,
  type HysteresisState,
  type MeasuredStatusLevel,
} from "./levels"
import { STATUS_LEVELS } from "./public"

describe("gravidade dos níveis", () => {
  it("tem um posto para cada nível, manutenção logo acima de operacional", () => {
    expect(Object.keys(STATUS_LEVEL_RANK).sort()).toEqual([...STATUS_LEVELS].sort())
    expect(STATUS_LEVEL_RANK.operational).toBeLessThan(STATUS_LEVEL_RANK.under_maintenance)
    expect(STATUS_LEVEL_RANK.under_maintenance).toBeLessThan(STATUS_LEVEL_RANK.degraded_performance)
    expect(STATUS_LEVEL_RANK.degraded_performance).toBeLessThan(STATUS_LEVEL_RANK.partial_outage)
    expect(STATUS_LEVEL_RANK.partial_outage).toBeLessThan(STATUS_LEVEL_RANK.major_outage)
  })

  it("escolhe o pior de dois e de uma lista", () => {
    expect(worseStatusLevel("operational", "partial_outage")).toBe("partial_outage")
    expect(worseStatusLevel("major_outage", "degraded_performance")).toBe("major_outage")
    expect(worstStatusLevel([])).toBe("operational")
    expect(worstStatusLevel([null, undefined, "degraded_performance"])).toBe("degraded_performance")
  })

  it("situação geral: manutenção só quando nada está pior", () => {
    expect(overallStatusLevel(["operational", "under_maintenance"])).toBe("under_maintenance")
    expect(overallStatusLevel(["under_maintenance", "degraded_performance"])).toBe(
      "degraded_performance"
    )
    expect(overallStatusLevel(["operational", "operational"])).toBe("operational")
  })

  it("lentidão conta como no ar; instabilidade e queda não", () => {
    expect(isAvailableLevel("operational")).toBe(true)
    expect(isAvailableLevel("degraded_performance")).toBe(true)
    expect(isAvailableLevel("partial_outage")).toBe(false)
    expect(isAvailableLevel("major_outage")).toBe(false)
  })

  it("reconhece níveis e partes válidos", () => {
    expect(isStatusLevel("major_outage")).toBe(true)
    expect(isStatusLevel("down")).toBe(false)
    expect(isStatusComponentKey("caixa_catalog")).toBe(true)
    expect(isStatusComponentKey("banco")).toBe(false)
  })
})

describe("componentStatusLevel", () => {
  it("sem medição nem incidente fica operacional (nunca vermelho)", () => {
    expect(
      componentStatusLevel({ measured: null, incidentImpacts: [], maintenanceInProgress: false })
    ).toBe("operational")
  })

  it("impacto do incidente vira nível", () => {
    expect(INCIDENT_IMPACT_LEVEL).toEqual({
      none: "operational",
      minor: "degraded_performance",
      major: "partial_outage",
      critical: "major_outage",
    })
    expect(
      componentStatusLevel({
        measured: "operational",
        incidentImpacts: ["minor", "critical"],
        maintenanceInProgress: false,
      })
    ).toBe("major_outage")
  })

  it("vale o pior entre incidente e medição", () => {
    expect(
      componentStatusLevel({
        measured: "partial_outage",
        incidentImpacts: ["minor"],
        maintenanceInProgress: false,
      })
    ).toBe("partial_outage")
  })

  it("manutenção ignora a medição, mas incidente pior vence", () => {
    expect(
      componentStatusLevel({
        measured: "major_outage",
        incidentImpacts: [],
        maintenanceInProgress: true,
      })
    ).toBe("under_maintenance")
    expect(
      componentStatusLevel({
        measured: "major_outage",
        incidentImpacts: ["none"],
        maintenanceInProgress: true,
      })
    ).toBe("under_maintenance")
    expect(
      componentStatusLevel({
        measured: "operational",
        incidentImpacts: ["major"],
        maintenanceInProgress: true,
      })
    ).toBe("partial_outage")
  })
})

describe("applyStatusHysteresis", () => {
  function run(measurements: MeasuredStatusLevel[]) {
    let state: HysteresisState = { level: null, candidate: null, candidateCount: 0 }
    return measurements.map((measured) => {
      state = applyStatusHysteresis(state, measured)
      return state.level
    })
  }

  it("só muda com 2 medições seguidas iguais (mesma sequência do teste SQL)", () => {
    expect(
      run([
        "operational",
        "operational",
        "partial_outage",
        "operational",
        "partial_outage",
        "partial_outage",
      ])
    ).toEqual([null, "operational", "operational", "operational", "operational", "partial_outage"])
  })

  it("candidato diferente reinicia a contagem", () => {
    expect(run(["operational", "operational", "major_outage", "partial_outage"])).toEqual([
      null,
      "operational",
      "operational",
      "operational",
    ])
  })
})

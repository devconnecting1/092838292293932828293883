import { describe, expect, it } from "vitest"

import {
  effectiveIncidentStatus,
  INCIDENT_LIMITS,
  isClosedIncidentStatus,
  nextIncidentStatuses,
  normalizeComponentKeys,
  prepareIncidentCreate,
  prepareIncidentEdit,
  prepareIncidentUpdate,
  prepareMaintenanceWindow,
  sanitizeIncidentMessage,
  sanitizeIncidentTitle,
} from "./incidents"

const NOW = new Date("2026-09-17T12:00:00Z")

/** "AAAA-MM-DDTHH:mm" no horário de Brasília para um instante UTC. */
function brasilia(iso: string): string {
  return new Date(Date.parse(iso) - 3 * 60 * 60 * 1000).toISOString().slice(0, 16)
}

describe("texto do incidente", () => {
  it("título: sem HTML, sem controle, uma linha", () => {
    expect(sanitizeIncidentTitle("  <b>CRM</b>   lento\n agora ")).toBe("CRM lento agora")
    expect(sanitizeIncidentTitle(42)).toBe("")
  })

  it("mensagem: mantém quebras de linha e limpa cada linha", () => {
    expect(
      sanitizeIncidentMessage(
        "Estamos <i>investigando</i>.\r\n\r\n\r\n\r\nMais <script>x</script> em breve.  "
      )
    ).toBe("Estamos investigando .\n\nMais x em breve.")
    expect(sanitizeIncidentMessage("\n\n  oi \n")).toBe("oi")
  })

  it("partes: só conhecidas, sem repetição, na ordem da página", () => {
    expect(normalizeComponentKeys(["login", "banco", "crm", "crm"])).toEqual(["crm", "login"])
    expect(normalizeComponentKeys("crm")).toEqual([])
  })
})

describe("estados", () => {
  it("encerrado não aceita novo estado", () => {
    expect(isClosedIncidentStatus("resolved")).toBe(true)
    expect(isClosedIncidentStatus("completed")).toBe(true)
    expect(nextIncidentStatuses("incident", "resolved")).toEqual([])
    expect(nextIncidentStatuses("maintenance", "completed")).toEqual([])
  })

  it("manutenção em andamento não volta para agendada", () => {
    expect(nextIncidentStatuses("maintenance", "scheduled")).toContain("scheduled")
    expect(nextIncidentStatuses("maintenance", "in_progress")).toEqual(["in_progress", "completed"])
    expect(nextIncidentStatuses("incident", "monitoring")).toContain("investigating")
  })

  it("manutenção agendada anda pelo relógio; o resto vale como gravado", () => {
    const timing = {
      status: "scheduled" as const,
      scheduledFor: "2026-09-17T13:00:00Z",
      scheduledUntil: "2026-09-17T15:00:00Z",
    }
    expect(effectiveIncidentStatus("maintenance", timing, NOW)).toBe("scheduled")
    expect(effectiveIncidentStatus("maintenance", timing, new Date("2026-09-17T14:00:00Z"))).toBe(
      "in_progress"
    )
    expect(effectiveIncidentStatus("maintenance", timing, new Date("2026-09-17T15:00:00Z"))).toBe(
      "completed"
    )
    expect(
      effectiveIncidentStatus(
        "maintenance",
        { ...timing, status: "in_progress" },
        new Date("2026-09-18T00:00:00Z")
      )
    ).toBe("in_progress")
    expect(
      effectiveIncidentStatus(
        "incident",
        { status: "monitoring", scheduledFor: null, scheduledUntil: null },
        NOW
      )
    ).toBe("monitoring")
  })
})

describe("prepareIncidentCreate", () => {
  const base = {
    kind: "incident",
    title: "CRM lento",
    impact: "minor",
    componentKeys: ["crm"],
    status: "investigating",
    message: "Estamos investigando.",
    scheduledFor: "",
    scheduledUntil: "",
  }

  it("incidente válido vira payload limpo, sem janela", () => {
    const result = prepareIncidentCreate({ ...base, componentKeys: ["login", "crm"] }, NOW)
    expect(result).toEqual({
      ok: true,
      payload: {
        kind: "incident",
        title: "CRM lento",
        impact: "minor",
        componentKeys: ["crm", "login"],
        status: "investigating",
        message: "Estamos investigando.",
        scheduledFor: null,
        scheduledUntil: null,
      },
    })
  })

  it("recusa título curto, mensagem vazia, sem partes, impacto e estado inválidos", () => {
    const result = prepareIncidentCreate(
      {
        ...base,
        title: "<b></b>x",
        message: "  ",
        componentKeys: ["banco"],
        impact: "enorme",
        status: "resolved",
      },
      NOW
    )
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(Object.keys(result.fieldErrors).sort()).toEqual(
        ["componentKeys", "impact", "message", "status", "title"].sort()
      )
    }
  })

  it("recusa texto acima do limite", () => {
    const result = prepareIncidentCreate(
      { ...base, message: "a".repeat(INCIDENT_LIMITS.messageMax + 1) },
      NOW
    )
    expect(result.ok).toBe(false)
  })

  it("manutenção exige janela futura de até 72 h, e o estado fica com o banco", () => {
    const ok = prepareIncidentCreate(
      {
        ...base,
        kind: "maintenance",
        status: "investigating",
        scheduledFor: brasilia("2026-09-18T05:00:00Z"),
        scheduledUntil: brasilia("2026-09-18T07:00:00Z"),
      },
      NOW
    )
    expect(ok).toMatchObject({
      ok: true,
      payload: {
        kind: "maintenance",
        status: null,
        scheduledFor: "2026-09-18T05:00:00.000Z",
        scheduledUntil: "2026-09-18T07:00:00.000Z",
      },
    })

    const tooLong = prepareIncidentCreate(
      {
        ...base,
        kind: "maintenance",
        scheduledFor: brasilia("2026-09-18T05:00:00Z"),
        scheduledUntil: brasilia("2026-09-21T06:00:00Z"),
      },
      NOW
    )
    expect(tooLong.ok).toBe(false)
  })
})

describe("prepareMaintenanceWindow", () => {
  it("fim no passado, antes do início ou início longe demais", () => {
    expect(
      prepareMaintenanceWindow(
        {
          scheduledFor: brasilia("2026-09-17T08:00:00Z"),
          scheduledUntil: brasilia("2026-09-17T11:00:00Z"),
        },
        NOW
      ).ok
    ).toBe(false)
    expect(
      prepareMaintenanceWindow(
        {
          scheduledFor: brasilia("2026-09-18T08:00:00Z"),
          scheduledUntil: brasilia("2026-09-18T07:00:00Z"),
        },
        NOW
      ).ok
    ).toBe(false)
    expect(
      prepareMaintenanceWindow(
        {
          scheduledFor: brasilia("2027-01-01T08:00:00Z"),
          scheduledUntil: brasilia("2027-01-01T09:00:00Z"),
        },
        NOW
      ).ok
    ).toBe(false)
  })

  it("aceita manutenção que já começou e termina no futuro", () => {
    expect(
      prepareMaintenanceWindow(
        {
          scheduledFor: brasilia("2026-09-17T11:00:00Z"),
          scheduledUntil: brasilia("2026-09-17T13:00:00Z"),
        },
        NOW
      ).ok
    ).toBe(true)
  })
})

describe("prepareIncidentUpdate", () => {
  it("estado permitido e mensagem válida", () => {
    expect(
      prepareIncidentUpdate(
        { status: "resolved", message: "Tudo normal." },
        { kind: "incident", currentStatus: "identified" }
      )
    ).toEqual({ ok: true, payload: { status: "resolved", message: "Tudo normal." } })
  })

  it("recusa estado de outro tipo e registro encerrado", () => {
    expect(
      prepareIncidentUpdate(
        { status: "in_progress", message: "Mensagem." },
        { kind: "incident", currentStatus: "identified" }
      ).ok
    ).toBe(false)
    expect(
      prepareIncidentUpdate(
        { status: "monitoring", message: "Mensagem." },
        { kind: "incident", currentStatus: "resolved" }
      ).ok
    ).toBe(false)
    expect(
      prepareIncidentUpdate(
        { status: "scheduled", message: "Mensagem." },
        { kind: "maintenance", currentStatus: "in_progress" }
      ).ok
    ).toBe(false)
  })
})

describe("prepareIncidentEdit", () => {
  const values = {
    title: "CRM fora do ar",
    impact: "critical",
    componentKeys: ["crm", "login"],
    scheduledFor: "",
    scheduledUntil: "",
  }

  it("incidente aberto muda título, impacto e partes", () => {
    expect(
      prepareIncidentEdit(
        values,
        { kind: "incident", status: "identified", impact: "minor", componentKeys: ["crm"] },
        NOW
      )
    ).toEqual({
      ok: true,
      payload: {
        title: "CRM fora do ar",
        impact: "critical",
        componentKeys: ["crm", "login"],
        scheduledFor: null,
        scheduledUntil: null,
      },
    })
  })

  it("encerrado só corrige o título", () => {
    const context = {
      kind: "incident" as const,
      status: "resolved" as const,
      impact: "critical" as const,
      componentKeys: ["login", "crm"] as const,
    }
    expect(
      prepareIncidentEdit(values, { ...context, componentKeys: ["crm", "login"] as const }, NOW).ok
    ).toBe(true)
    const changed = prepareIncidentEdit(
      { ...values, impact: "minor", componentKeys: ["crm"] },
      { ...context, componentKeys: ["crm", "login"] as const },
      NOW
    )
    expect(changed.ok).toBe(false)
    if (!changed.ok) {
      expect(Object.keys(changed.fieldErrors).sort()).toEqual(["componentKeys", "impact"])
    }
  })

  it("manutenção agendada exige janela válida", () => {
    const context = {
      kind: "maintenance" as const,
      status: "scheduled" as const,
      impact: "none" as const,
      componentKeys: ["crm"] as const,
    }
    expect(prepareIncidentEdit({ ...values, impact: "none" }, context, NOW).ok).toBe(false)
    expect(
      prepareIncidentEdit(
        {
          ...values,
          impact: "none",
          scheduledFor: brasilia("2026-09-18T05:00:00Z"),
          scheduledUntil: brasilia("2026-09-18T06:00:00Z"),
        },
        context,
        NOW
      ).ok
    ).toBe(true)
  })
})

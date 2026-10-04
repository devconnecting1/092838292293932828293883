import { describe, expect, it } from "vitest"

import { buildGettingStarted, type GettingStartedFacts } from "./getting-started"

const EMPTY: GettingStartedFacts = {
  finishedImports: 0,
  properties: 0,
  activeMembers: 1,
  pendingInvitations: 0,
  hasOrganizationPhone: false,
  pushDevices: 0,
  dailyDigestEnabled: false,
}

describe("buildGettingStarted", () => {
  it("conta nova: nenhum passo feito, na ordem sugerida", () => {
    const progress = buildGettingStarted(EMPTY)

    expect(progress.steps.map((step) => step.id)).toEqual([
      "import_spreadsheet",
      "first_property",
      "invite_team",
      "organization_whatsapp",
      "phone_alerts",
      "daily_digest",
    ])
    expect(progress.doneCount).toBe(0)
    expect(progress.total).toBe(6)
    expect(progress.allDone).toBe(false)
  })

  it("marca sozinho o que os dados mostram", () => {
    const progress = buildGettingStarted({
      ...EMPTY,
      finishedImports: 1,
      properties: 3,
      pendingInvitations: 1,
      dailyDigestEnabled: true,
    })

    expect(progress.steps.filter((step) => step.done).map((step) => step.id)).toEqual([
      "import_spreadsheet",
      "first_property",
      "invite_team",
      "daily_digest",
    ])
    expect(progress.doneCount).toBe(4)
  })

  it("equipe conta com outro membro ativo, não só com convite", () => {
    const progress = buildGettingStarted({ ...EMPTY, activeMembers: 2 })

    expect(progress.steps.find((step) => step.id === "invite_team")?.done).toBe(true)
  })

  it("sem avisos no celular na instalação, o passo some", () => {
    const progress = buildGettingStarted({
      finishedImports: 2,
      properties: 1,
      activeMembers: 4,
      pendingInvitations: 0,
      hasOrganizationPhone: true,
      pushDevices: null,
      dailyDigestEnabled: true,
    })

    expect(progress.steps.some((step) => step.id === "phone_alerts")).toBe(false)
    expect(progress.total).toBe(5)
    expect(progress.allDone).toBe(true)
  })

  it("ignora contagens inválidas", () => {
    const progress = buildGettingStarted({ ...EMPTY, properties: Number.NaN, finishedImports: -1 })

    expect(progress.doneCount).toBe(0)
  })
})

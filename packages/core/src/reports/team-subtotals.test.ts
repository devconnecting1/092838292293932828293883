import { describe, expect, it } from "vitest"

import { countTeamGroups, groupRowsByTeam, NO_TEAM_LABEL, sumFields } from "./team-subtotals"

type Row = {
  name: string
  teamId: string | null
  teamName: string | null
  received: number
  salesAmount: number
}

const rows: Row[] = [
  { name: "Ana", teamId: "t-sul", teamName: "Zona Sul", received: 10, salesAmount: 500_000 },
  { name: "Bruno", teamId: null, teamName: null, received: 4, salesAmount: 0 },
  { name: "Carla", teamId: "t-norte", teamName: "Zona Norte", received: 7, salesAmount: 0.1 },
  { name: "Davi", teamId: "t-sul", teamName: "Zona Sul", received: 3, salesAmount: 0.2 },
  { name: "Eva", teamId: "t-centro", teamName: "Centro", received: 6, salesAmount: 250_000 },
]

describe("groupRowsByTeam", () => {
  it("agrupa por equipe em ordem alfabética, com Sem equipe no fim", () => {
    const groups = groupRowsByTeam(rows)

    expect(groups.map((group) => group.teamName)).toEqual([
      "Centro",
      "Zona Norte",
      "Zona Sul",
      NO_TEAM_LABEL,
    ])
  })

  it("mantém a ordem do banco (ranking) dentro de cada equipe", () => {
    const sul = groupRowsByTeam(rows).find((group) => group.teamId === "t-sul")

    expect(sul?.rows.map((row) => row.name)).toEqual(["Ana", "Davi"])
  })

  it("dá nome à equipe que veio sem nome", () => {
    const [group] = groupRowsByTeam([
      { name: "X", teamId: "t", teamName: "  ", received: 1, salesAmount: 0 },
    ])

    expect(group?.teamName).toBe("Equipe sem nome")
  })

  it("conta os grupos, incluindo Sem equipe", () => {
    expect(countTeamGroups(rows)).toBe(4)
    expect(countTeamGroups([])).toBe(0)
  })
})

describe("sumFields", () => {
  it("a soma dos subtotais das equipes é igual ao total em todas as colunas", () => {
    const keys = ["received", "salesAmount"] as const
    const total = sumFields(rows, keys)
    const subtotals = groupRowsByTeam(rows).map((group) => sumFields(group.rows, keys))

    for (const key of keys) {
      const sum = subtotals.reduce((acc, subtotal) => acc + subtotal[key], 0)
      expect(Math.round(sum * 100) / 100).toBe(total[key])
    }

    expect(total).toEqual({ received: 30, salesAmount: 750_000.3 })
  })

  it("trata valor não finito como zero e lista vazia como zero", () => {
    expect(
      sumFields(
        [{ name: "", teamId: null, teamName: null, received: Number.NaN, salesAmount: 1 }],
        ["received", "salesAmount"]
      )
    ).toEqual({ received: 0, salesAmount: 1 })
    expect(sumFields([] as Row[], ["received"])).toEqual({ received: 0 })
  })
})

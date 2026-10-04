import { describe, expect, it } from "vitest"

import {
  checkAddMember,
  checkLeaderChoice,
  findTeamNameConflict,
  leaderCandidates,
  membersWithoutTeam,
  normalizeTeamName,
  teamIdOf,
  teamNameKey,
  teamsLedBy,
} from "./rules"

const teams = [
  { id: "t-sul", name: "Zona Sul", leaderId: "u-ana" },
  { id: "t-norte", name: "Zona Norte", leaderId: null },
]

const members = [
  { id: "u-ana", active: true },
  { id: "u-bruno", active: true },
  { id: "u-carla", active: true },
  { id: "u-davi", active: false },
  { id: "u-eva", active: true },
]

const teamMembers = [
  { userId: "u-ana", teamId: "t-sul" },
  { userId: "u-bruno", teamId: "t-sul" },
  { userId: "u-carla", teamId: "t-norte" },
  { userId: "u-davi", teamId: "t-norte" },
]

describe("nome da equipe", () => {
  it("junta espaços e compara sem maiúsculas", () => {
    expect(normalizeTeamName("  Zona   Sul ")).toBe("Zona Sul")
    expect(teamNameKey(" ZONA  sul")).toBe("zona sul")
  })

  it("acha conflito, mas ignora a própria equipe ao renomear", () => {
    expect(findTeamNameConflict("zona sul", teams)?.id).toBe("t-sul")
    expect(findTeamNameConflict("Zona Sul", teams, "t-sul")).toBeNull()
    expect(findTeamNameConflict("Centro", teams)).toBeNull()
    expect(findTeamNameConflict("   ", teams)).toBeNull()
  })
})

describe("participação", () => {
  it("diz a equipe de cada pessoa e quem lidera o quê", () => {
    expect(teamIdOf("u-carla", teamMembers)).toBe("t-norte")
    expect(teamIdOf("u-eva", teamMembers)).toBeNull()
    expect(teamsLedBy("u-ana", teams).map((team) => team.id)).toEqual(["t-sul"])
  })

  it("lista só ativos sem equipe", () => {
    expect(membersWithoutTeam(members, teamMembers).map((member) => member.id)).toEqual(["u-eva"])
  })
})

describe("escolha do líder", () => {
  const context = { members, teamMembers }

  it("aceita membro da equipe ou sem equipe", () => {
    expect(checkLeaderChoice("t-sul", "u-bruno", context)).toBeNull()
    expect(checkLeaderChoice("t-sul", "u-eva", context)).toBeNull()
  })

  it("recusa quem está em outra equipe, inativo ou de fora", () => {
    expect(checkLeaderChoice("t-sul", "u-carla", context)).toBe("other_team")
    expect(checkLeaderChoice("t-norte", "u-davi", context)).toBe("inactive")
    expect(checkLeaderChoice("t-sul", "u-estranho", context)).toBe("not_member")
  })

  it("monta a lista de candidatos", () => {
    expect(leaderCandidates("t-sul", context).map((member) => member.id)).toEqual([
      "u-ana",
      "u-bruno",
      "u-eva",
    ])
    expect(leaderCandidates("t-norte", context).map((member) => member.id)).toEqual([
      "u-carla",
      "u-eva",
    ])
  })
})

describe("inclusão de membro", () => {
  const context = { teams, members, teamMembers }

  it("inclui quem não tem equipe", () => {
    expect(checkAddMember("t-norte", "u-eva", context)).toEqual({ ok: true, fromTeamId: null })
  })

  it("move quem está em outra equipe", () => {
    expect(checkAddMember("t-norte", "u-bruno", context)).toEqual({
      ok: true,
      fromTeamId: "t-sul",
    })
  })

  it("não move o líder de outra equipe", () => {
    expect(checkAddMember("t-norte", "u-ana", context)).toEqual({
      ok: false,
      problem: "leads_other_team",
      teamId: "t-sul",
    })
  })

  it("recusa repetido, inativo e de fora", () => {
    expect(checkAddMember("t-sul", "u-bruno", context)).toEqual({
      ok: false,
      problem: "already_in_team",
    })
    expect(checkAddMember("t-sul", "u-davi", context)).toEqual({ ok: false, problem: "inactive" })
    expect(checkAddMember("t-sul", "u-x", context)).toEqual({ ok: false, problem: "not_member" })
  })
})

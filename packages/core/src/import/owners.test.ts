import { describe, expect, it } from "vitest"

import { ownerSharesAreValid, parseImportOwners, parseOwnerShare } from "./owners"

const empty = { name: null, document: null, phone: null, email: null, share: null }

describe("parseOwnerShare", () => {
  it("aceita número pt-BR com ou sem %", () => {
    expect(parseOwnerShare("50")).toEqual({ ok: true, value: 50 })
    expect(parseOwnerShare("33,33 %")).toEqual({ ok: true, value: 33.33 })
    expect(parseOwnerShare("100%")).toEqual({ ok: true, value: 100 })
    expect(parseOwnerShare("")).toEqual({ ok: true, value: null })
  })

  it("recusa zero, acima de 100 e mais de 2 casas", () => {
    expect(parseOwnerShare("0")).toEqual({ ok: false })
    expect(parseOwnerShare("100,5")).toEqual({ ok: false })
    expect(parseOwnerShare("33,333")).toEqual({ ok: false })
    expect(parseOwnerShare("metade")).toEqual({ ok: false })
  })
})

describe("ownerSharesAreValid", () => {
  it("todos ou nenhum, somando 100 (com arredondamento)", () => {
    expect(ownerSharesAreValid([null, null])).toBe(true)
    expect(ownerSharesAreValid([60, 40])).toBe(true)
    expect(ownerSharesAreValid([33.33, 33.33, 33.34])).toBe(true)
    expect(ownerSharesAreValid([50, 40])).toBe(false)
    expect(ownerSharesAreValid([100, null])).toBe(false)
  })
})

describe("parseImportOwners", () => {
  it("sem colunas de proprietário não traz nada", () => {
    expect(parseImportOwners(empty)).toEqual({ owners: [], issue: null })
  })

  it("alinha vários proprietários separados por |", () => {
    const result = parseImportOwners({
      name: "Maria da Silva | João Souza",
      document: "529.982.247-25 |",
      phone: " | (11) 98765-4321",
      email: "MARIA@EXEMPLO.COM |",
      share: "60 | 40",
    })

    expect(result).toEqual({
      issue: null,
      owners: [
        {
          name: "Maria da Silva",
          document: "52998224725",
          email: "maria@exemplo.com",
          share_percent: 60,
        },
        { name: "João Souza", phone: "11987654321", share_percent: 40 },
      ],
    })
  })

  it("um proprietário sem percentual", () => {
    expect(parseImportOwners({ ...empty, name: "Ana", email: "ana@exemplo.com" })).toEqual({
      issue: null,
      owners: [{ name: "Ana", email: "ana@exemplo.com" }],
    })
  })

  it("percentuais que não somam 100 ou faltando em algum", () => {
    expect(
      parseImportOwners({ ...empty, name: "A | B", email: "a@x.com | b@x.com", share: "50 | 40" })
        .issue
    ).toBe("invalid_owner_share")
    expect(
      parseImportOwners({ ...empty, name: "A | B", email: "a@x.com | b@x.com", share: "100 |" })
        .issue
    ).toBe("invalid_owner_share")
  })

  it("proprietário sem nome, sem contato ou com CPF inválido", () => {
    expect(parseImportOwners({ ...empty, email: "a@x.com" }).issue).toBe("invalid_owner")
    expect(parseImportOwners({ ...empty, name: "Sem Contato" }).issue).toBe("invalid_owner")
    expect(parseImportOwners({ ...empty, name: "Ana", document: "111.111.111-11" }).issue).toBe(
      "invalid_owner"
    )
  })
})

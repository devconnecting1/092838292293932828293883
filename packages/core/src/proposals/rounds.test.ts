import { describe, expect, it } from "vitest"

import {
  allowedRoundKinds,
  describeRoundTerms,
  formatRoundTitle,
  isProposalRoundKind,
  PROPOSAL_ROUND_KIND_LABELS,
  statusAfterRound,
} from "./rounds"

const money = (value: number) => `R$ ${value}`

describe("allowedRoundKinds", () => {
  it("rascunho só corrige a proposta inicial", () => {
    expect(allowedRoundKinds("draft")).toEqual(["initial"])
  })

  it("em negociação: contraproposta do proprietário ou nova oferta do cliente", () => {
    expect(allowedRoundKinds("sent")).toEqual(["owner_counter", "client_offer"])
    expect(allowedRoundKinds("countered")).toEqual(["owner_counter", "client_offer"])
  })

  it("encerrada não ganha rodada", () => {
    expect(allowedRoundKinds("accepted")).toEqual([])
    expect(allowedRoundKinds("rejected")).toEqual([])
    expect(allowedRoundKinds("withdrawn")).toEqual([])
  })
})

describe("statusAfterRound", () => {
  it("contraproposta deixa a proposta como contraproposta", () => {
    expect(statusAfterRound("owner_counter", "sent")).toBe("countered")
    expect(statusAfterRound("owner_counter", "countered")).toBe("countered")
  })

  it("nova oferta do cliente reenvia a proposta", () => {
    expect(statusAfterRound("client_offer", "countered")).toBe("sent")
    expect(statusAfterRound("client_offer", "sent")).toBe("sent")
  })

  it("nova oferta que espera aprovação de desconto não é enviada", () => {
    expect(statusAfterRound("client_offer", "sent", { holdForApproval: true })).toBe("countered")
  })

  it("correção da proposta inicial mantém o status", () => {
    expect(statusAfterRound("initial", "draft")).toBe("draft")
  })
})

describe("describeRoundTerms", () => {
  it("lista só o que foi informado, na ordem do documento", () => {
    expect(
      describeRoundTerms(
        {
          downPayment: 100000,
          financingAmount: null,
          exchangeDescription: "  Apartamento no Tatuapé ",
          paymentDeadline: "Escritura em 60 dias",
        },
        money
      )
    ).toEqual([
      { label: "Sinal", value: "R$ 100000" },
      { label: "Permuta", value: "Apartamento no Tatuapé" },
      { label: "Prazo", value: "Escritura em 60 dias" },
    ])
  })

  it("sinal zero aparece; texto em branco não", () => {
    expect(
      describeRoundTerms(
        {
          downPayment: 0,
          financingAmount: 500000,
          exchangeDescription: " ",
          paymentDeadline: null,
        },
        money
      )
    ).toEqual([
      { label: "Sinal", value: "R$ 0" },
      { label: "Financiamento", value: "R$ 500000" },
    ])
  })
})

describe("rótulos", () => {
  it("título da rodada", () => {
    expect(formatRoundTitle(3, "owner_counter")).toBe("Rodada 3 · Contraproposta do proprietário")
    expect(PROPOSAL_ROUND_KIND_LABELS.client_offer).toBe("Nova oferta do cliente")
  })

  it("reconhece só os tipos do banco", () => {
    expect(isProposalRoundKind("initial")).toBe(true)
    expect(isProposalRoundKind("counter")).toBe(false)
  })
})

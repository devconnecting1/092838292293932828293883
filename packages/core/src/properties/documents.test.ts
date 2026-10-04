import { describe, expect, it } from "vitest"

import {
  buildPropertyDocumentPath,
  getPropertyDocumentValidity,
  isPropertyDocumentKind,
  isPropertyDocumentMimeType,
  isPropertyDocumentPath,
  PROPERTY_DOCUMENT_KIND_LABELS,
  PROPERTY_DOCUMENT_KIND_VALUES,
  propertyDocumentFileName,
} from "./documents"

const ORG = "11111111-1111-4111-8111-111111111111"
const PROPERTY = "22222222-2222-4222-8222-222222222222"
const FILE = "33333333-3333-4333-8333-333333333333"

describe("tipos de documento", () => {
  it("tem rótulo em pt-BR para cada tipo do banco", () => {
    for (const kind of PROPERTY_DOCUMENT_KIND_VALUES) {
      expect(PROPERTY_DOCUMENT_KIND_LABELS[kind]).toBeTruthy()
    }
    expect(PROPERTY_DOCUMENT_KIND_LABELS.registry).toBe("Matrícula")
    expect(PROPERTY_DOCUMENT_KIND_LABELS.occupancy_permit).toBe("Habite-se")
  })

  it("reconhece só os valores do enum", () => {
    expect(isPropertyDocumentKind("iptu")).toBe(true)
    expect(isPropertyDocumentKind("rg")).toBe(false)
    expect(isPropertyDocumentKind(null)).toBe(false)
  })

  it("aceita PDF e imagens", () => {
    expect(isPropertyDocumentMimeType("application/pdf")).toBe(true)
    expect(isPropertyDocumentMimeType("image/webp")).toBe(true)
    expect(isPropertyDocumentMimeType("image/heic")).toBe(false)
    expect(isPropertyDocumentMimeType("toString")).toBe(false)
  })
})

describe("caminho no Storage", () => {
  it("usa nome aleatório com a extensão do tipo, sem o nome enviado", () => {
    const path = buildPropertyDocumentPath(ORG, PROPERTY, FILE, "application/pdf")
    expect(path).toBe(`${ORG}/properties/${PROPERTY}/${FILE}.pdf`)
    expect(isPropertyDocumentPath(path, ORG, PROPERTY, "application/pdf")).toBe(true)
    expect(buildPropertyDocumentPath(ORG, PROPERTY, FILE.toUpperCase(), "image/jpeg")).toMatch(
      /\/33333333-3333-4333-8333-333333333333\.jpg$/
    )
  })

  it("recusa identificador que não é uuid", () => {
    expect(() =>
      buildPropertyDocumentPath(ORG, PROPERTY, "Matricula Joao", "application/pdf")
    ).toThrow()
  })

  it("recusa caminho de outro imóvel, com nome livre ou extensão trocada", () => {
    const other = "44444444-4444-4444-8444-444444444444"
    expect(
      isPropertyDocumentPath(
        `${ORG}/properties/${other}/${FILE}.pdf`,
        ORG,
        PROPERTY,
        "application/pdf"
      )
    ).toBe(false)
    expect(
      isPropertyDocumentPath(
        `${ORG}/properties/${PROPERTY}/Matricula Joao Silva.pdf`,
        ORG,
        PROPERTY,
        "application/pdf"
      )
    ).toBe(false)
    expect(
      isPropertyDocumentPath(
        `${ORG}/properties/${PROPERTY}/${FILE}.jpg`,
        ORG,
        PROPERTY,
        "application/pdf"
      )
    ).toBe(false)
    expect(
      isPropertyDocumentPath(
        `${ORG}/properties/${PROPERTY}/x/${FILE}.pdf`,
        ORG,
        PROPERTY,
        "application/pdf"
      )
    ).toBe(false)
  })

  it("nome do download traz tipo e código, nunca dado pessoal", () => {
    expect(propertyDocumentFileName("registry", "IMV-000123", "application/pdf")).toBe(
      "matricula-IMV-000123.pdf"
    )
    expect(propertyDocumentFileName("certificate", "IMV 12/../x", "image/png")).toBe(
      "certidao-IMV12x.png"
    )
  })
})

describe("getPropertyDocumentValidity", () => {
  const today = "2026-09-16"

  it("sem data de validade", () => {
    expect(getPropertyDocumentValidity(null, today)).toEqual({ state: "no_expiry" })
    expect(getPropertyDocumentValidity("", today)).toEqual({ state: "no_expiry" })
    expect(getPropertyDocumentValidity("16/09/2026", today)).toEqual({ state: "no_expiry" })
  })

  it("vale até o fim do dia do vencimento", () => {
    expect(getPropertyDocumentValidity("2026-09-16", today)).toEqual({
      state: "expiring",
      daysLeft: 0,
    })
    expect(getPropertyDocumentValidity("2026-09-15", today)).toEqual({
      state: "expired",
      daysOverdue: 1,
    })
  })

  it("avisa nos 30 dias antes do vencimento", () => {
    expect(getPropertyDocumentValidity("2026-10-16", today)).toEqual({
      state: "expiring",
      daysLeft: 30,
    })
    expect(getPropertyDocumentValidity("2026-10-17", today)).toEqual({
      state: "valid",
      daysLeft: 31,
    })
  })

  it("conta dias certos na virada do ano", () => {
    expect(getPropertyDocumentValidity("2027-01-01", "2026-12-31")).toEqual({
      state: "expiring",
      daysLeft: 1,
    })
  })
})

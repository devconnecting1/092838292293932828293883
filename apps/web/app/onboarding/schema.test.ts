/**
 * Casos do schema de onboarding (imobiliária x corretor autônomo).
 *
 * ATENÇÃO: apps/web não tem runner de testes configurado (vitest só existe na
 * raiz do monorepo, usado por packages/core). Este arquivo documenta os casos
 * e roda assim que o app ganhar um script de teste (mesmo padrão de
 * @/lib/landing/theme.test.ts).
 */
import { describe, expect, it } from "vitest"

import {
  isOrganizationKind,
  organizationSchema,
  type OrganizationValues,
} from "@/app/onboarding/schema"

const BASE: OrganizationValues = {
  kind: "company",
  name: "Horizonte Imóveis",
  slug: "horizonte-imoveis",
  legalName: "Horizonte Negócios Imobiliários Ltda.",
  cnpj: "",
  creci: "J-12345",
  creciNumber: "",
  creciState: "",
  city: "Campinas",
  state: "SP",
}

describe("organizationSchema — imobiliária (pessoa jurídica)", () => {
  it("aceita quando razão social e CRECI jurídico estão preenchidos", () => {
    const result = organizationSchema.safeParse(BASE)
    expect(result.success).toBe(true)
  })

  it("recusa sem razão social", () => {
    const result = organizationSchema.safeParse({ ...BASE, legalName: "" })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.path[0] === "legalName")).toBe(true)
    }
  })

  it("recusa sem CRECI jurídico", () => {
    const result = organizationSchema.safeParse({ ...BASE, creci: "" })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.path[0] === "creci")).toBe(true)
    }
  })

  it("não exige CRECI de pessoa física", () => {
    const result = organizationSchema.safeParse({ ...BASE, creciNumber: "", creciState: "" })
    expect(result.success).toBe(true)
  })

  it("aceita CNPJ vazio (opcional) mas recusa CNPJ inválido", () => {
    expect(organizationSchema.safeParse({ ...BASE, cnpj: "" }).success).toBe(true)
    expect(organizationSchema.safeParse({ ...BASE, cnpj: "11111111111111" }).success).toBe(false)
  })
})

describe("organizationSchema — corretor autônomo (pessoa física)", () => {
  const PERSON: OrganizationValues = {
    ...BASE,
    kind: "person",
    name: "Ana Souza Imóveis",
    slug: "ana-souza-imoveis",
    legalName: "",
    cnpj: "",
    creci: "",
    creciNumber: "12345",
    creciState: "SP",
  }

  it("conclui sem CNPJ nem razão social quando o CRECI (número + UF) está preenchido", () => {
    const result = organizationSchema.safeParse(PERSON)
    expect(result.success).toBe(true)
  })

  it("recusa sem o número do CRECI", () => {
    const result = organizationSchema.safeParse({ ...PERSON, creciNumber: "" })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.path[0] === "creciNumber")).toBe(true)
    }
  })

  it("recusa sem a UF do CRECI", () => {
    const result = organizationSchema.safeParse({ ...PERSON, creciState: "" })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.path[0] === "creciState")).toBe(true)
    }
  })

  it("não exige razão social nem CRECI jurídico", () => {
    const result = organizationSchema.safeParse({ ...PERSON, legalName: "", creci: "" })
    expect(result.success).toBe(true)
  })

  it("continua exigindo cidade e UF (comuns às duas opções)", () => {
    expect(organizationSchema.safeParse({ ...PERSON, city: "" }).success).toBe(false)
    expect(organizationSchema.safeParse({ ...PERSON, state: "" }).success).toBe(false)
  })
})

describe("isOrganizationKind", () => {
  it("aceita apenas 'company' e 'person'", () => {
    expect(isOrganizationKind("company")).toBe(true)
    expect(isOrganizationKind("person")).toBe(true)
    expect(isOrganizationKind("outro")).toBe(false)
    expect(isOrganizationKind(undefined)).toBe(false)
  })
})

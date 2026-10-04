import { describe, expect, it } from "vitest"

import { caixaUploadReminderEmail } from "./caixa-templates"
import { EmailTemplateError } from "./templates"

const ORIGIN = "https://seucrm.com.br"

function reminder(overrides: Partial<Parameters<typeof caixaUploadReminderEmail>[0]> = {}) {
  return caixaUploadReminderEmail({
    origin: ORIGIN,
    syncedAt: "2026-09-16T12:30:00Z",
    generatedOn: "2026-09-16",
    totalActive: 10_540,
    ageHours: 43,
    ...overrides,
  })
}

describe("caixaUploadReminderEmail", () => {
  it("traz a data declarada pela Caixa, a da carga e os dois links", () => {
    const email = reminder()

    expect(email.subject).toBe("Atualize a lista da Caixa (a atual é de 16/09/2026)")
    expect(email.text).toContain("Lista da Caixa de: 16/09/2026")
    expect(email.text).toContain("16 de setembro de 2026 às 09:30")
    expect(email.text).toContain("10.540")
    expect(email.text).toContain("mais de 24 horas")
    expect(email.html).toContain('href="https://seucrm.com.br/plataforma/caixa"')
    expect(email.html).toContain(
      'href="https://venda-imoveis.caixa.gov.br/sistema/download-lista.asp"'
    )
  })

  it("conta em dias quando a carga já tem dois dias ou mais", () => {
    expect(reminder({ ageHours: 75 }).text).toContain("carregado há 3 dias")
  })

  it("funciona sem a data declarada no arquivo", () => {
    const email = reminder({ generatedOn: null, totalActive: null })

    expect(email.subject).toBe("Atualize a lista de imóveis da Caixa")
    expect(email.text).not.toContain("Lista da Caixa de:")
  })

  it("não monta e-mail com origem inválida", () => {
    expect(() => reminder({ origin: "javascript:alert(1)" })).toThrow(EmailTemplateError)
  })
})

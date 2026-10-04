import { describe, expect, it } from "vitest"

import {
  ORGANIZATION_DELETION_SETTINGS_PATH,
  organizationDeletionEmail,
} from "./organization-deletion-templates"
import { EmailTemplateError } from "./templates"

const ORIGIN = "https://imob-teste.seucrm.com.br"

function email(overrides: Partial<Parameters<typeof organizationDeletionEmail>[0]> = {}) {
  return organizationDeletionEmail({
    origin: ORIGIN,
    brand: { name: "Imobiliária Teste", primaryColor: "#123456" },
    recipientName: "Carla Souza",
    kind: "scheduled",
    organizationName: "Imobiliária Teste",
    executeAfter: "2026-10-17T12:00:00Z",
    ...overrides,
  })
}

describe("organizationDeletionEmail", () => {
  it("agendamento: data, modo leitura e link para cancelar", () => {
    const rendered = email()

    expect(rendered.subject).toBe(
      "Exclusão de Imobiliária Teste agendada para 17 de outubro de 2026"
    )
    expect(rendered.text).toContain("modo leitura")
    expect(rendered.text).toContain("Olá, Carla!")
    expect(rendered.text).toContain(`${ORIGIN}${ORGANIZATION_DELETION_SETTINGS_PATH}`)
    expect(rendered.html).toContain("Cancelar a exclusão")
  })

  it("aviso de 3 dias tem assunto próprio", () => {
    const rendered = email({ kind: "reminder" })

    expect(rendered.subject).toBe(
      "Faltam 3 dias: Imobiliária Teste será apagada em 17 de outubro de 2026"
    )
    expect(rendered.text).toContain("Exclusão definitiva em 17 de outubro de 2026.")
  })

  it("escapa o nome da imobiliária", () => {
    const rendered = email({ organizationName: '<script>alert("x")</script>' })

    expect(rendered.html).not.toContain("<script>")
    expect(rendered.html).toContain("&lt;script&gt;")
  })

  it("recusa origem ou data inválida", () => {
    expect(() => email({ origin: "javascript:alert(1)" })).toThrow(EmailTemplateError)
    expect(() => email({ executeAfter: "não é data" })).toThrow(EmailTemplateError)
  })
})

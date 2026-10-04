import { describe, expect, it } from "vitest"

import { statusAutoIncidentAlertEmail } from "./status-alert-templates"
import { EmailTemplateError } from "./templates"

const ORIGIN = "https://seucrm.com.br"

function alert(overrides: Partial<Parameters<typeof statusAutoIncidentAlertEmail>[0]> = {}) {
  return statusAutoIncidentAlertEmail({
    origin: ORIGIN,
    kind: "opened",
    title: "Instabilidade em várias partes do sistema",
    impact: "critical",
    componentKeys: ["login", "crm", "desconhecida"],
    startedAt: "2026-09-17T12:30:00Z",
    ...overrides,
  })
}

describe("statusAutoIncidentAlertEmail", () => {
  it("abertura: título, impacto, partes na ordem da página e links do Console e da página pública", () => {
    const email = alert()

    expect(email.subject).toBe("Incidente automático: Instabilidade em várias partes do sistema")
    expect(email.text).toContain("Impacto crítico")
    expect(email.text).toContain("CRM, Login e contas")
    expect(email.text).not.toContain("desconhecida")
    expect(email.text).toContain("17 de setembro de 2026 às 09:30")
    expect(email.text).toContain("Assumir")
    expect(email.html).toContain('href="https://seucrm.com.br/plataforma/status"')
    expect(email.html).toContain('href="https://seucrm.com.br/status"')
  })

  it("resolução traz quando resolveu", () => {
    const email = alert({ kind: "resolved", resolvedAt: "2026-09-17T13:05:00Z" })

    expect(email.subject).toBe("Resolvido: Instabilidade em várias partes do sistema")
    expect(email.text).toContain("10:05")
  })

  it("escapa o título", () => {
    const email = alert({ title: 'Instabilidade <script>alert("x")</script>' })

    expect(email.html).not.toContain("<script>")
  })

  it("recusa origem, tipo ou impacto inválidos", () => {
    expect(() => alert({ origin: "javascript:alert(1)" })).toThrow(EmailTemplateError)
    expect(() => alert({ kind: "outro" as never })).toThrow(EmailTemplateError)
    expect(() => alert({ impact: "enorme" as never })).toThrow(EmailTemplateError)
    expect(() => alert({ title: "   " })).toThrow(EmailTemplateError)
  })
})

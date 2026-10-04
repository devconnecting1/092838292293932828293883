import { describe, expect, it } from "vitest"

import {
  CONSENT_CHANNEL_LABELS,
  CONSENT_CHANNELS,
  CONSENT_DISCLOSURE_MAX_LENGTH,
  CONSENT_MARKETING_PURPOSES,
  CONSENT_POLICY_VERSION,
  CONSENT_PURPOSE_DEFINITIONS,
  CONSENT_PURPOSES,
  CONSENT_SOURCE_LABELS,
  CONSENT_SOURCES,
  CONSENT_SOURCES_WITHOUT_PROOF,
  defaultDisclosureText,
  isConsentPurpose,
  isConsentSource,
} from "./purposes"

describe("finalidades granulares", () => {
  it("toda finalidade tem definição e rótulo", () => {
    for (const purpose of CONSENT_PURPOSES) {
      const definition = CONSENT_PURPOSE_DEFINITIONS[purpose]
      expect(definition.key).toBe(purpose)
      expect(definition.label.length).toBeGreaterThan(2)
      expect(definition.description.length).toBeGreaterThan(10)
    }
  })

  it("não existe finalidade genérica: nada chamado 'tudo', 'geral' ou 'marketing'", () => {
    // Autorização genérica é nula (LGPD, art. 8º, § 4º).
    for (const purpose of CONSENT_PURPOSES) {
      expect(["tudo", "geral", "todos", "marketing"]).not.toContain(purpose)
    }
  })

  it("divulgação exige consentimento; atendimento tem outra base legal declarada", () => {
    expect(CONSENT_PURPOSE_DEFINITIONS.divulgacao.requiresConsent).toBe(true)
    expect(CONSENT_PURPOSE_DEFINITIONS.atendimento.requiresConsent).toBe(false)
    expect(CONSENT_PURPOSE_DEFINITIONS.atendimento.alternativeLegalBasis).toContain("art. 7º, V")
  })

  it("CONSENT_MARKETING_PURPOSES é derivado, não uma segunda lista para desincronizar", () => {
    const esperado = CONSENT_PURPOSES.filter(
      (purpose) => CONSENT_PURPOSE_DEFINITIONS[purpose].requiresConsent
    )
    expect([...CONSENT_MARKETING_PURPOSES]).toEqual([...esperado])
    expect(CONSENT_MARKETING_PURPOSES).toContain("divulgacao")
    expect(CONSENT_MARKETING_PURPOSES).not.toContain("atendimento")
  })

  it("isConsentPurpose recusa o que não está no enum", () => {
    expect(isConsentPurpose("divulgacao")).toBe(true)
    expect(isConsentPurpose("qualquer_coisa")).toBe(false)
    expect(isConsentPurpose(true)).toBe(false)
  })
})

describe("origem da coleta", () => {
  it("toda origem tem rótulo", () => {
    for (const source of CONSENT_SOURCES) {
      expect(CONSENT_SOURCE_LABELS[source]).toBeTruthy()
    }
  })

  it("planilha, portal e indicação não provam consentimento", () => {
    expect([...CONSENT_SOURCES_WITHOUT_PROOF]).toEqual(["importacao", "portal", "indicacao"])
    for (const source of CONSENT_SOURCES_WITHOUT_PROOF) {
      expect(isConsentSource(source)).toBe(true)
    }
  })
})

describe("canais", () => {
  it("todo canal tem rótulo", () => {
    for (const channel of CONSENT_CHANNELS) {
      expect(CONSENT_CHANNEL_LABELS[channel]).toBeTruthy()
    }
  })
})

describe("texto exibido ao titular", () => {
  it("cita a finalidade, o canal e o direito de revogar", () => {
    const texto = defaultDisclosureText("divulgacao", "whatsapp", "Imobiliária Exemplo")

    expect(texto).toContain("Imobiliária Exemplo")
    expect(texto).toContain("ofertas")
    expect(texto).toContain("WhatsApp")
    expect(texto).toContain("revogar")
  })

  it("cabe no limite guardado no banco e é longo o bastante para valer como prova", () => {
    for (const purpose of CONSENT_PURPOSES) {
      for (const channel of CONSENT_CHANNELS) {
        const texto = defaultDisclosureText(purpose, channel, "Imobiliária Exemplo")
        expect(texto.length).toBeGreaterThanOrEqual(20)
        expect(texto.length).toBeLessThanOrEqual(CONSENT_DISCLOSURE_MAX_LENGTH)
      }
    }
  })

  it("a versão da política tem forma de data", () => {
    expect(CONSENT_POLICY_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})

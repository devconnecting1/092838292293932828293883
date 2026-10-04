import { describe, expect, it } from "vitest"

import {
  CONNECTION_PROVIDER_KEYS,
  CONNECTION_PROVIDER_ORDER,
  CONNECTION_PROVIDERS,
  formatProviderPrice,
  isConnectionProviderKey,
  META_WHATSAPP_PRICE_MILLICENTS_BRL,
  META_WHATSAPP_TERMS,
} from "./providers"
import { canSendThroughConnection, connectionHealth } from "./status"

describe("catálogo de provedores", () => {
  it("todo provedor do enum tem definição, e a ordem cobre todos", () => {
    for (const key of CONNECTION_PROVIDER_KEYS) {
      expect(CONNECTION_PROVIDERS[key].key).toBe(key)
    }
    expect([...CONNECTION_PROVIDER_ORDER].sort()).toEqual([...CONNECTION_PROVIDER_KEYS].sort())
  })

  it("nenhum provedor com custo por uso é pago por nós", () => {
    for (const key of CONNECTION_PROVIDER_KEYS) {
      const provider = CONNECTION_PROVIDERS[key]
      const cobra = provider.billing.items.some((item) => (item.millicentsBRL ?? 0) > 0)
      if (cobra) {
        expect(provider.billing.payer).toBe("client_direct")
      }
    }
  })

  it("o WhatsApp diz na tela que a Meta cobra a imobiliária direto", () => {
    const whatsapp = CONNECTION_PROVIDERS.whatsapp
    expect(whatsapp.billing.payer).toBe("client_direct")
    expect(whatsapp.billing.headline).toContain("Meta cobra a imobiliária direto")
    expect(whatsapp.billing.invoicedBy).toContain("Facebook")
    // Uma conta Meta por imobiliária: nunca um portfólio guarda-chuva nosso.
    expect(whatsapp.maxAccounts).toBe(1)
  })

  it("o WhatsApp vende só a conexão, sem prometer a caixa de atendimento que não existe", () => {
    const whatsapp = CONNECTION_PROVIDERS.whatsapp
    // Conectar a conta existe (status "available"); atender pela caixa, não.
    expect(whatsapp.status).toBe("available")
    expect(whatsapp.summary).not.toMatch(/mesma caixa|vários corretores|atenda/i)
    expect(whatsapp.summary).toContain("ainda está em construção")
  })

  it("Lead Ads aponta para a tela de Integrações, onde já funciona", () => {
    const leadAds = CONNECTION_PROVIDERS.facebook_lead_ads
    expect(leadAds.status).toBe("soon")
    expect(leadAds.summary).toContain("Integrações")
  })

  it("isConnectionProviderKey recusa o que não está no enum", () => {
    expect(isConnectionProviderKey("whatsapp")).toBe(true)
    expect(isConnectionProviderKey("whatsapp_web")).toBe(false)
    expect(isConnectionProviderKey(null)).toBe(false)
  })
})

describe("termos da Meta", () => {
  it("o texto exibido é longo o bastante para ser prova e cita a cobrança direta", () => {
    expect(META_WHATSAPP_TERMS.text.length).toBeGreaterThan(200)
    expect(META_WHATSAPP_TERMS.text).toContain("Meta cobra o envio de mensagens diretamente")
    expect(META_WHATSAPP_TERMS.url.startsWith("https://")).toBe(true)
    expect(META_WHATSAPP_TERMS.key).toMatch(/^[a-z0-9_]{3,60}$/)
  })
})

describe("formatProviderPrice", () => {
  it("mostra as quatro casas de R$ 0,0350 em vez de arredondar para R$ 0,04", () => {
    expect(formatProviderPrice(META_WHATSAPP_PRICE_MILLICENTS_BRL.service)).toBe("R$ 0,0350")
    expect(formatProviderPrice(META_WHATSAPP_PRICE_MILLICENTS_BRL.marketing)).toBe("R$ 0,3217")
  })

  it("valor redondo em centavos usa duas casas", () => {
    expect(formatProviderPrice(100_000)).toBe("R$ 1,00")
    expect(formatProviderPrice(0)).toBe("R$ 0,00")
  })

  it("sem preço publicado mostra travessão", () => {
    expect(formatProviderPrice(null)).toBe("—")
    expect(formatProviderPrice(Number.NaN)).toBe("—")
  })
})

describe("saúde da conexão", () => {
  const base = { status: "connected" as const, enabled: true, blockedAt: null }

  it("o bloqueio da plataforma vence o interruptor da imobiliária", () => {
    expect(connectionHealth({ ...base, blockedAt: "2026-09-16T00:00:00Z" })).toBe("blocked")
    expect(connectionHealth({ ...base, enabled: false, blockedAt: "2026-09-16T00:00:00Z" })).toBe(
      "blocked"
    )
  })

  it("desligado não é erro nem desconectado", () => {
    expect(connectionHealth({ ...base, enabled: false })).toBe("paused")
    expect(connectionHealth({ ...base, status: "error" })).toBe("error")
    expect(connectionHealth({ ...base, status: "revoked" })).toBe("revoked")
    expect(connectionHealth({ ...base, status: "pending" })).toBe("pending")
    expect(connectionHealth(null)).toBe("not_connected")
  })

  it("só conexão ativa envia", () => {
    expect(canSendThroughConnection(base)).toBe(true)
    expect(canSendThroughConnection({ ...base, enabled: false })).toBe(false)
    expect(canSendThroughConnection({ ...base, blockedAt: "2026-09-16T00:00:00Z" })).toBe(false)
    expect(canSendThroughConnection(null)).toBe(false)
  })
})

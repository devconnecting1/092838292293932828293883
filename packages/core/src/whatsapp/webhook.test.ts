import { describe, expect, it } from "vitest"

import {
  parseHubSignature,
  readWhatsappTimestamp,
  readWhatsappWebhook,
  whatsappWebhookEventKey,
  type WhatsappStatusEvent,
  type WhatsappUserPreferenceEvent,
} from "./webhook"

const WABA_ID = "102290129340398"
const PHONE_NUMBER_ID = "106540352242922"
const WAMID = "wamid.HBgLMTY1MDM4Nzk0MzkVAgASGBQzQTRBNjU5OUFFRTAzODEwMTQ0RgA="

function envelope(field: string, value: Record<string, unknown>) {
  return {
    object: "whatsapp_business_account",
    entry: [{ id: WABA_ID, changes: [{ field, value }] }],
  }
}

const METADATA = { display_phone_number: "5511999998888", phone_number_id: PHONE_NUMBER_ID }

describe("parseHubSignature", () => {
  it("aceita o formato exato da Meta", () => {
    expect(parseHubSignature(`sha256=${"a".repeat(64)}`)).toBe("a".repeat(64))
  })

  it("normaliza maiúsculas", () => {
    expect(parseHubSignature(`sha256=${"AB".repeat(32)}`)).toBe("ab".repeat(32))
  })

  it("recusa prefixo ausente, tamanho errado e caractere fora do hexadecimal", () => {
    expect(parseHubSignature("a".repeat(64))).toBeNull()
    expect(parseHubSignature("sha1=" + "a".repeat(40))).toBeNull()
    expect(parseHubSignature("sha256=" + "a".repeat(63))).toBeNull()
    expect(parseHubSignature("sha256=" + "z".repeat(64))).toBeNull()
    expect(parseHubSignature(null)).toBeNull()
    expect(parseHubSignature(undefined)).toBeNull()
  })
})

describe("readWhatsappTimestamp", () => {
  it("lê segundos em string (statuses) e em número (user_preferences)", () => {
    expect(readWhatsappTimestamp("1749416383")).toBe("2025-06-08T20:59:43.000Z")
    expect(readWhatsappTimestamp(1749416383)).toBe("2025-06-08T20:59:43.000Z")
  })

  it("descarta relógio absurdo em vez de gravar data errada", () => {
    expect(readWhatsappTimestamp(0)).toBeNull()
    expect(readWhatsappTimestamp("99999999999999")).toBeNull()
    expect(readWhatsappTimestamp("ontem")).toBeNull()
    expect(readWhatsappTimestamp(null)).toBeNull()
  })
})

describe("readWhatsappWebhook — corpo hostil", () => {
  it("nunca lança e nunca devolve evento para corpo sem forma", () => {
    for (const payload of [null, undefined, 1, "x", [], {}, { object: "page" }]) {
      const result = readWhatsappWebhook(payload)
      expect(result.events).toEqual([])
    }
  })

  it("descarta entrada sem id de WABA", () => {
    const result = readWhatsappWebhook({
      object: "whatsapp_business_account",
      entry: [{ id: "não-numérico", changes: [] }],
    })
    expect(result.events).toEqual([])
    expect(result.discarded).toBe(1)
  })

  it("ignora campo fora de escopo sem contar como descarte", () => {
    const result = readWhatsappWebhook(envelope("account_update", { event: "PARTNER_ADDED" }))
    expect(result.events).toEqual([])
    expect(result.discarded).toBe(0)
  })
})

describe("readWhatsappWebhook — mensagem recebida", () => {
  it("lê texto, contato e nome do perfil", () => {
    const result = readWhatsappWebhook(
      envelope("messages", {
        messaging_product: "whatsapp",
        metadata: METADATA,
        contacts: [{ profile: { name: "Sheena Nelson" }, wa_id: "5511988887777" }],
        messages: [
          {
            from: "5511988887777",
            id: WAMID,
            timestamp: "1749416383",
            type: "text",
            text: { body: "Ainda está disponível?" },
          },
        ],
      })
    )

    expect(result.events).toHaveLength(1)
    expect(result.events[0]).toEqual({
      kind: "message",
      wabaId: WABA_ID,
      phoneNumberId: PHONE_NUMBER_ID,
      displayPhoneNumber: "5511999998888",
      wamid: WAMID,
      contactWaId: "5511988887777",
      contactName: "Sheena Nelson",
      body: "Ainda está disponível?",
      messageType: "text",
      sentAt: "2025-06-08T20:59:43.000Z",
    })
  })

  it("usa a legenda quando a mensagem é mídia, e null quando não há texto", () => {
    const read = (message: Record<string, unknown>) =>
      readWhatsappWebhook(
        envelope("messages", {
          metadata: METADATA,
          messages: [{ from: "5511988887777", id: WAMID, ...message }],
        })
      ).events[0]

    expect(read({ type: "image", image: { caption: "Fachada" } })).toMatchObject({
      body: "Fachada",
    })
    expect(read({ type: "audio", audio: {} })).toMatchObject({ body: null })
    expect(read({ type: "button", button: { text: "Quero visitar" } })).toMatchObject({
      body: "Quero visitar",
    })
  })

  it("descarta mensagem sem wamid ou sem remetente", () => {
    const result = readWhatsappWebhook(
      envelope("messages", {
        metadata: METADATA,
        messages: [{ from: "5511988887777" }, { id: WAMID }, "texto solto"],
      })
    )

    expect(result.events).toEqual([])
    expect(result.discarded).toBe(3)
  })
})

describe("readWhatsappWebhook — status de entrega", () => {
  it("lê pricing por type e category, e não por billable", () => {
    const [event] = readWhatsappWebhook(
      envelope("messages", {
        metadata: METADATA,
        statuses: [
          {
            id: WAMID,
            status: "sent",
            timestamp: "1750030073",
            recipient_id: "5511988887777",
            pricing: {
              billable: true,
              pricing_model: "PMP",
              type: "regular",
              category: "marketing",
            },
          },
        ],
      })
    ).events as WhatsappStatusEvent[]

    expect(event).toMatchObject({
      kind: "status",
      status: "sent",
      pricingCategory: "marketing",
      pricingType: "regular",
      errorCode: null,
    })
  })

  it("lê o primeiro erro do array (131049, 132015)", () => {
    const read = (code: number) =>
      readWhatsappWebhook(
        envelope("messages", {
          metadata: METADATA,
          statuses: [
            {
              id: WAMID,
              status: "failed",
              timestamp: "1751142888",
              errors: [{ code, title: "erro", message: "erro" }],
            },
          ],
        })
      ).events[0] as WhatsappStatusEvent

    expect(read(131049).errorCode).toBe(131049)
    expect(read(132015).errorCode).toBe(132015)
    expect(read(131050).errorCode).toBe(131050)
  })

  it("descarta categoria de preço que não existe no catálogo da Meta", () => {
    const [event] = readWhatsappWebhook(
      envelope("messages", {
        metadata: METADATA,
        statuses: [{ id: WAMID, status: "delivered", pricing: { category: "promocao" } }],
      })
    ).events as WhatsappStatusEvent[]

    expect(event?.pricingCategory).toBeNull()
  })
})

describe("readWhatsappWebhook — preferência de divulgação", () => {
  it("lê stop e resume de marketing_messages", () => {
    const read = (value: string) =>
      readWhatsappWebhook(
        envelope("user_preferences", {
          metadata: METADATA,
          user_preferences: [
            {
              wa_id: "5511988887777",
              category: "marketing_messages",
              value,
              timestamp: 1731705721,
              detail: "User requested to resume marketing messages",
            },
          ],
        })
      ).events[0] as WhatsappUserPreferenceEvent

    expect(read("stop")).toMatchObject({ kind: "user_preference", value: "stop" })
    expect(read("resume")).toMatchObject({ kind: "user_preference", value: "resume" })
  })

  it("descarta categoria desconhecida em vez de adivinhar", () => {
    const result = readWhatsappWebhook(
      envelope("user_preferences", {
        metadata: METADATA,
        user_preferences: [{ wa_id: "5511988887777", category: "service_messages", value: "stop" }],
      })
    )

    expect(result.events).toEqual([])
    expect(result.discarded).toBe(1)
  })
})

describe("readWhatsappWebhook — qualidade do número", () => {
  it("lê o evento pelo número exibido, que é o que a Meta manda aqui", () => {
    const [event] = readWhatsappWebhook(
      envelope("phone_number_quality_update", {
        display_phone_number: "5511999998888",
        event: "THROUGHPUT_UPGRADE",
        current_limit: "TIER_UNLIMITED",
      })
    ).events

    expect(event).toEqual({
      kind: "quality",
      wabaId: WABA_ID,
      displayPhoneNumber: "5511999998888",
      phoneNumberId: null,
      event: "THROUGHPUT_UPGRADE",
      currentLimit: "TIER_UNLIMITED",
    })
  })
})

describe("whatsappWebhookEventKey", () => {
  it("distingue os estados do mesmo wamid: sent, delivered e read não se anulam", () => {
    const base = {
      kind: "status" as const,
      wabaId: WABA_ID,
      phoneNumberId: PHONE_NUMBER_ID,
      wamid: WAMID,
      recipientWaId: null,
      errorCode: null,
      errorTitle: null,
      pricingCategory: null,
      pricingType: null,
      at: null,
    }

    const keys = ["sent", "delivered", "read"].map((status) =>
      whatsappWebhookEventKey({ ...base, status })
    )

    expect(new Set(keys).size).toBe(3)
  })

  it("é estável para a mesma entrega repetida", () => {
    const event = {
      kind: "message" as const,
      wabaId: WABA_ID,
      phoneNumberId: PHONE_NUMBER_ID,
      displayPhoneNumber: null,
      wamid: WAMID,
      contactWaId: "5511988887777",
      contactName: null,
      body: "oi",
      messageType: "text",
      sentAt: null,
    }

    expect(whatsappWebhookEventKey(event)).toBe(whatsappWebhookEventKey({ ...event, body: "OI" }))
  })
})

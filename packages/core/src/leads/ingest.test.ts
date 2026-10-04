import { describe, expect, it } from "vitest"

import {
  findRecentDuplicate,
  isCanalProListingLead,
  isSameContact,
  leadContactKeys,
  LEAD_INGEST_DEDUP_WINDOW_HOURS,
  normalizeCanalProLead,
  normalizeExternalEventId,
  normalizeIngestEmail,
  normalizeIngestMessage,
  normalizeIngestName,
  normalizeIngestPhone,
  normalizeMetaLead,
  parseMetaLeadgenEvents,
  parseMetaSignatureHeader,
  toIngestInstant,
  toLeadIngestOrigin,
  toLeadInterest,
  toIngestLeadPayload,
  type ExistingLead,
} from "./ingest"

const NOW = Date.UTC(2026, 8, 16, 12, 0, 0)
const HOUR = 60 * 60 * 1000

// -----------------------------------------------------------------------------
// Normalização de campos
// -----------------------------------------------------------------------------

describe("normalizeIngestName", () => {
  it("apara, junta espaços e corta em 120", () => {
    expect(normalizeIngestName("  Maria   da   Silva \n")).toBe("Maria da Silva")
    expect(normalizeIngestName("a".repeat(200))).toHaveLength(120)
  })

  it("recusa nome curto demais ou vazio", () => {
    expect(normalizeIngestName("M")).toBeNull()
    expect(normalizeIngestName("   ")).toBeNull()
    expect(normalizeIngestName(null)).toBeNull()
    expect(normalizeIngestName({ nome: "Maria" })).toBeNull()
  })
})

describe("normalizeIngestEmail", () => {
  it("normaliza para minúsculas e tira espaços", () => {
    expect(normalizeIngestEmail("  Maria.Silva+zap@Exemplo.COM.br ")).toBe(
      "maria.silva+zap@exemplo.com.br"
    )
  })

  it("recusa o que o CHECK do banco recusaria", () => {
    expect(normalizeIngestEmail("maria@@exemplo.com")).toBeNull()
    expect(normalizeIngestEmail("maria..silva@exemplo.com")).toBeNull()
    expect(normalizeIngestEmail("maria@exemplo")).toBeNull()
    expect(normalizeIngestEmail(`${"a".repeat(250)}@exemplo.com`)).toBeNull()
    expect(normalizeIngestEmail("maria@exemplo.com?x=1")).toBeNull()
  })
})

describe("normalizeIngestPhone", () => {
  it("tira máscara, +55 e o 0 da operadora", () => {
    expect(normalizeIngestPhone("+55 (11) 98888-7777")).toBe("11988887777")
    expect(normalizeIngestPhone("5511988887777")).toBe("11988887777")
    expect(normalizeIngestPhone("011988887777")).toBe("11988887777")
    expect(normalizeIngestPhone("1133334444")).toBe("1133334444")
    expect(normalizeIngestPhone(11988887777)).toBe("11988887777")
  })

  it("recusa número que não é discável no Brasil", () => {
    expect(normalizeIngestPhone("999")).toBeNull()
    // DDD inexistente.
    expect(normalizeIngestPhone("0988887777")).toBeNull()
    // Número começando em 0 ou 1 depois do DDD.
    expect(normalizeIngestPhone("11088887777")).toBeNull()
    expect(normalizeIngestPhone("")).toBeNull()
    expect(normalizeIngestPhone(null)).toBeNull()
  })
})

describe("normalizeIngestMessage", () => {
  it("preserva quebras de linha e corta em 2.000", () => {
    expect(normalizeIngestMessage(" Olá\nTenho interesse ")).toBe("Olá\nTenho interesse")
    expect(normalizeIngestMessage("x".repeat(3000))).toHaveLength(2000)
    expect(normalizeIngestMessage("   ")).toBeNull()
  })
})

describe("normalizeExternalEventId", () => {
  it("aceita o id da origem e corta em 200", () => {
    expect(normalizeExternalEventId(" 59ee0fc6e4b043e1b2a6d863 ")).toBe("59ee0fc6e4b043e1b2a6d863")
    expect(normalizeExternalEventId(1234567890)).toBe("1234567890")
    expect(normalizeExternalEventId("a".repeat(300))).toHaveLength(200)
  })

  it("recusa id vazio", () => {
    expect(normalizeExternalEventId("   ")).toBeNull()
    expect(normalizeExternalEventId(null)).toBeNull()
  })
})

describe("toLeadIngestOrigin", () => {
  it('trata "Grupo OLX" como Canal Pro, não como o portal OLX', () => {
    // O payload do Grupo OLX não diz em qual dos três sites a pessoa estava.
    expect(toLeadIngestOrigin("Grupo OLX")).toBe("canalpro")
    expect(toLeadIngestOrigin("MCMV_OLX")).toBe("canalpro")
  })

  it("reconhece os portais e as redes", () => {
    expect(toLeadIngestOrigin("zapimoveis")).toBe("zapimoveis")
    expect(toLeadIngestOrigin("VivaReal")).toBe("vivareal")
    expect(toLeadIngestOrigin("OLX")).toBe("olx")
    expect(toLeadIngestOrigin("ig")).toBe("instagram")
    expect(toLeadIngestOrigin(null, "facebook")).toBe("facebook")
  })
})

describe("toLeadInterest", () => {
  it("traduz o tipo de transação do portal", () => {
    expect(toLeadInterest("SELL")).toBe("buy")
    expect(toLeadInterest("RENT")).toBe("rent")
    expect(toLeadInterest("Locação")).toBe("rent")
    expect(toLeadInterest("qualquer coisa")).toBeNull()
  })
})

describe("toIngestInstant", () => {
  it("aceita ISO e epoch em segundos ou milissegundos", () => {
    expect(toIngestInstant("2026-09-16T11:00:00.000Z", NOW)).toBe("2026-09-16T11:00:00.000Z")
    expect(toIngestInstant(Math.floor(NOW / 1000) - 60, NOW)).toBe("2026-09-16T11:59:00.000Z")
    expect(toIngestInstant(String(Math.floor(NOW / 1000)), NOW)).toBe("2026-09-16T12:00:00.000Z")
  })

  it("recusa data absurda (payload adulterado)", () => {
    expect(toIngestInstant("1999-01-01T00:00:00Z", NOW)).toBeNull()
    expect(toIngestInstant(NOW + 5 * 24 * HOUR, NOW)).toBeNull()
    expect(toIngestInstant("ontem", NOW)).toBeNull()
  })
})

// -----------------------------------------------------------------------------
// Deduplicação (mesma regra de lead_duplicate_flags)
// -----------------------------------------------------------------------------

describe("leadContactKeys", () => {
  it("casa pelos últimos 11 dígitos, como o banco", () => {
    expect(leadContactKeys({ phone: "5511988887777" }).phoneKey).toBe("11988887777")
    expect(leadContactKeys({ phone: "11988887777" }).phoneKey).toBe("11988887777")
    expect(leadContactKeys({ email: " Maria@Exemplo.com " }).emailKey).toBe("maria@exemplo.com")
    expect(leadContactKeys({}).phoneKey).toBeNull()
  })
})

describe("isSameContact", () => {
  it("é a mesma pessoa quando o telefone OU o e-mail batem", () => {
    expect(isSameContact({ phone: "+55 11 98888-7777" }, { phone: "11988887777" })).toBe(true)
    expect(isSameContact({ email: "M@x.com" }, { email: "m@x.com" })).toBe(true)
    expect(isSameContact({ phone: "11988887777" }, { phone: "11955554444" })).toBe(false)
  })

  it("não casa dois contatos sem nenhum dado", () => {
    expect(isSameContact({}, {})).toBe(false)
    expect(isSameContact({ phone: null, email: null }, { phone: null, email: null })).toBe(false)
  })
})

describe("findRecentDuplicate", () => {
  const existing: ExistingLead[] = [
    { id: "antigo", phone: "11988887777", createdAt: new Date(NOW - 40 * HOUR).toISOString() },
    { id: "recente", phone: "5511988887777", createdAt: new Date(NOW - 2 * HOUR).toISOString() },
    { id: "outro", email: "outro@exemplo.com", createdAt: new Date(NOW - HOUR).toISOString() },
  ]

  it("acha o lead mais recente da mesma pessoa dentro da janela", () => {
    expect(findRecentDuplicate({ phone: "(11) 98888-7777" }, existing, NOW)?.id).toBe("recente")
  })

  it("ignora o que está fora da janela de 24 h", () => {
    const soAntigo = existing.filter((lead) => lead.id === "antigo")
    expect(findRecentDuplicate({ phone: "11988887777" }, soAntigo, NOW)).toBeNull()
    expect(LEAD_INGEST_DEDUP_WINDOW_HOURS).toBe(24)
  })

  it("respeita uma janela maior quando pedida", () => {
    const soAntigo = existing.filter((lead) => lead.id === "antigo")
    expect(findRecentDuplicate({ phone: "11988887777" }, soAntigo, NOW, 72)?.id).toBe("antigo")
  })

  it("não casa quem não é a mesma pessoa", () => {
    expect(findRecentDuplicate({ phone: "11911112222" }, existing, NOW)).toBeNull()
  })
})

// -----------------------------------------------------------------------------
// Canal Pro (Grupo OLX)
// -----------------------------------------------------------------------------

const canalProPayload = {
  leadOrigin: "Grupo OLX",
  timestamp: "2026-09-16T11:50:30.619Z",
  originLeadId: "59ee0fc6e4b043e1b2a6d863",
  originListingId: "87027856",
  clientListingId: "a40171",
  name: "Nome Consumidor",
  email: "nome.consumidor@email.com",
  ddd: "11",
  phone: "999999999",
  phoneNumber: "11999999999",
  message: "Olá, tenho interesse neste imóvel.",
  temperature: "Alta",
  transactionType: "SELL",
  extraData: { leadCerto: true, leadType: "CONTACT_FORM" },
}

describe("normalizeCanalProLead", () => {
  it("normaliza o payload documentado do Grupo OLX", () => {
    const result = normalizeCanalProLead(canalProPayload, NOW)

    expect(result.ok).toBe(true)

    if (!result.ok) {
      return
    }

    expect(result.lead.eventId).toBe("59ee0fc6e4b043e1b2a6d863")
    expect(result.lead.name).toBe("Nome Consumidor")
    expect(result.lead.email).toBe("nome.consumidor@email.com")
    // ddd + phone (phoneNumber está depreciado).
    expect(result.lead.phone).toBe("11999999999")
    expect(result.lead.interest).toBe("buy")
    // clientListingId é o <ListingID> do nosso feed VRSync.
    expect(result.lead.listingCode).toBe("a40171")
    expect(result.lead.origin).toBe("canalpro")
    expect(result.lead.occurredAt).toBe("2026-09-16T11:50:30.619Z")
    expect(result.lead.utm).toEqual({
      source: "canalpro",
      medium: "portal",
      campaign: "CONTACT_FORM",
      content: "87027856",
    })
    expect(result.lead.message).toContain("Olá, tenho interesse neste imóvel.")
    expect(result.lead.message).toContain("Formulário do anúncio")
    expect(result.lead.message).toContain("interesse alta")
  })

  it("usa phoneNumber quando ddd e phone não vêm", () => {
    const result = normalizeCanalProLead({ ...canalProPayload, ddd: null, phone: null }, NOW)

    expect(result.ok && result.lead.phone).toBe("11999999999")
  })

  it("recusa sem nome e sem contato, sempre com o id do evento", () => {
    const semNome = normalizeCanalProLead({ ...canalProPayload, name: " " }, NOW)
    expect(semNome.ok).toBe(false)
    expect(semNome).toMatchObject({ reason: "sem_nome", eventId: "59ee0fc6e4b043e1b2a6d863" })

    const semContato = normalizeCanalProLead(
      { ...canalProPayload, email: null, ddd: null, phone: null, phoneNumber: null },
      NOW
    )
    expect(semContato).toMatchObject({
      ok: false,
      reason: "sem_contato",
      eventId: "59ee0fc6e4b043e1b2a6d863",
    })
  })

  it("leva o que deu para aproveitar na recusa, para o banco registrar o motivo", () => {
    const semNome = normalizeCanalProLead({ ...canalProPayload, name: " " }, NOW)

    expect(semNome.ok).toBe(false)

    if (semNome.ok) {
      return
    }

    // O banco é quem decide aceitar ou recusar; o payload parcial é o que faz a
    // entrega recusada aparecer na tela com telefone, anúncio e origem.
    expect(semNome.partial).toMatchObject({
      event_id: "59ee0fc6e4b043e1b2a6d863",
      name: "",
      phone: "11999999999",
      listing_code: "a40171",
      origin: "canalpro",
    })
  })

  it("recusa payload que não é objeto e entrega sem id", () => {
    expect(normalizeCanalProLead("<html>", NOW)).toEqual({
      ok: false,
      reason: "payload_invalido",
      eventId: null,
      partial: null,
    })
    expect(normalizeCanalProLead({ ...canalProPayload, originLeadId: null }, NOW)).toEqual({
      ok: false,
      reason: "evento_sem_id",
      eventId: null,
      partial: null,
    })
  })

  it("resume a simulação do Minha Casa Minha Vida na mensagem", () => {
    const result = normalizeCanalProLead(
      {
        ...canalProPayload,
        leadOrigin: "MCMV_OLX",
        clientListingId: null,
        message: null,
        extraData: {
          leadType: "CONTACT_FORM",
          mcmv: {
            unitType: "Apartamento",
            propertyLocation: { city: "Recife", state: "PE" },
            propertyValue: "250000",
            urgencyToBuy: "Até 3 meses",
          },
        },
      },
      NOW
    )

    expect(result.ok && result.lead.listingCode).toBeNull()
    expect(result.ok && result.lead.message).toContain("Minha Casa Minha Vida")
    expect(result.ok && result.lead.message).toContain("Recife/PE")
  })
})

describe("isCanalProListingLead", () => {
  it("distingue lead de anúncio da simulação MCMV", () => {
    // Lead de anúncio sem clientListingId precisa de 4xx (o Grupo OLX reenvia).
    expect(isCanalProListingLead(canalProPayload)).toBe(true)
    expect(isCanalProListingLead({ leadOrigin: "MCMV_OLX" })).toBe(false)
    expect(isCanalProListingLead({ leadOrigin: "mcmv_olx" })).toBe(false)
    expect(isCanalProListingLead(null)).toBe(false)
  })
})

// -----------------------------------------------------------------------------
// Meta Lead Ads
// -----------------------------------------------------------------------------

describe("parseMetaLeadgenEvents", () => {
  it("lê todas as mudanças de todos os entries", () => {
    const events = parseMetaLeadgenEvents(
      {
        object: "page",
        entry: [
          {
            id: 153125381133,
            time: 1758018000,
            changes: [
              {
                field: "leadgen",
                value: {
                  leadgen_id: 123123123123,
                  page_id: 123123123,
                  form_id: 12312312312,
                  adgroup_id: 1,
                  ad_id: 2,
                  created_time: Math.floor(NOW / 1000),
                },
              },
              {
                field: "leadgen",
                value: { leadgen_id: 999, page_id: 123123123 },
              },
            ],
          },
        ],
      },
      NOW
    )

    expect(events).toHaveLength(2)
    expect(events[0]).toEqual({
      leadgenId: "123123123123",
      pageId: "123123123",
      formId: "12312312312",
      adId: "2",
      adgroupId: "1",
      createdAt: "2026-09-16T12:00:00.000Z",
    })
    expect(events[1]?.createdAt).toBeNull()
  })

  it("descarta envelope de outro objeto, outro campo ou malformado", () => {
    expect(parseMetaLeadgenEvents({ object: "user", entry: [] }, NOW)).toEqual([])
    expect(
      parseMetaLeadgenEvents(
        { object: "page", entry: [{ id: 1, changes: [{ field: "feed", value: {} }] }] },
        NOW
      )
    ).toEqual([])
    expect(parseMetaLeadgenEvents("não é json de webhook", NOW)).toEqual([])
    expect(parseMetaLeadgenEvents({ object: "page" }, NOW)).toEqual([])
  })

  it("cai no id do entry quando value.page_id não vem", () => {
    const events = parseMetaLeadgenEvents(
      {
        object: "page",
        entry: [{ id: "555", changes: [{ field: "leadgen", value: { leadgen_id: "7" } }] }],
      },
      NOW
    )

    expect(events[0]?.pageId).toBe("555")
  })
})

describe("normalizeMetaLead", () => {
  const event = {
    leadgenId: "9988776655",
    pageId: "123123123",
    formId: "42",
    adId: "77",
    adgroupId: null,
    createdAt: "2026-09-16T11:00:00.000Z",
  }

  it("mapeia os campos padrão do formulário", () => {
    const result = normalizeMetaLead(
      {
        event,
        fieldData: [
          { name: "full_name", values: ["Carlos Souza"] },
          { name: "email", values: ["carlos@exemplo.com"] },
          { name: "phone_number", values: ["+55 11 98888-7777"] },
        ],
        platform: "ig",
        formName: "Campanha Lançamento",
      },
      NOW
    )

    expect(result.ok).toBe(true)

    if (!result.ok) {
      return
    }

    expect(result.lead.eventId).toBe("9988776655")
    expect(result.lead.name).toBe("Carlos Souza")
    expect(result.lead.phone).toBe("11988887777")
    expect(result.lead.origin).toBe("instagram")
    expect(result.lead.occurredAt).toBe("2026-09-16T11:00:00.000Z")
    expect(result.lead.utm).toEqual({
      source: "instagram",
      medium: "lead_ads",
      campaign: "Campanha Lançamento",
      content: "77",
    })
  })

  it("junta first_name e last_name e vira mensagem com as perguntas extras", () => {
    const result = normalizeMetaLead(
      {
        event,
        fieldData: [
          { name: "first_name", values: ["Ana"] },
          { name: "last_name", values: ["Lima"] },
          { name: "email", values: ["ana@exemplo.com"] },
          { name: "Quando pretende comprar?", values: ["Nos próximos 3 meses"] },
          { name: "Bairros de interesse", values: ["Boa Viagem", "Pina"] },
        ],
      },
      NOW
    )

    expect(result.ok && result.lead.name).toBe("Ana Lima")
    expect(result.ok && result.lead.origin).toBe("facebook")
    expect(result.ok && result.lead.message).toBe(
      "Quando pretende comprar?: Nos próximos 3 meses\nBairros de interesse: Boa Viagem, Pina"
    )
  })

  it("recusa lead sem contato aproveitável", () => {
    expect(
      normalizeMetaLead({ event, fieldData: [{ name: "full_name", values: ["Ana Lima"] }] }, NOW)
    ).toMatchObject({ ok: false, reason: "sem_contato", eventId: "9988776655" })
  })

  it("aguenta field_data ausente ou torto", () => {
    expect(normalizeMetaLead({ event, fieldData: [] }, NOW).ok).toBe(false)
    expect(
      normalizeMetaLead({ event, fieldData: [{ name: null, values: null }] as never }, NOW).ok
    ).toBe(false)
  })
})

describe("parseMetaSignatureHeader", () => {
  it("aceita só sha256=<64 hex>", () => {
    expect(parseMetaSignatureHeader(`sha256=${"A".repeat(64)}`)).toBe("a".repeat(64))
    expect(parseMetaSignatureHeader(`sha1=${"a".repeat(40)}`)).toBeNull()
    expect(parseMetaSignatureHeader("sha256=zz")).toBeNull()
    expect(parseMetaSignatureHeader(null)).toBeNull()
    expect(parseMetaSignatureHeader(undefined)).toBeNull()
  })
})

// -----------------------------------------------------------------------------
// Payload da RPC
// -----------------------------------------------------------------------------

describe("toIngestLeadPayload", () => {
  it("omite as chaves vazias, como a RPC espera", () => {
    const result = normalizeCanalProLead(
      {
        ...canalProPayload,
        email: null,
        clientListingId: null,
        message: null,
        temperature: null,
        extraData: {},
      },
      NOW
    )

    expect(result.ok).toBe(true)

    if (!result.ok) {
      return
    }

    const payload = toIngestLeadPayload(result.lead)

    expect(payload).toEqual({
      event_id: "59ee0fc6e4b043e1b2a6d863",
      name: "Nome Consumidor",
      phone: "11999999999",
      interest: "buy",
      origin: "canalpro",
      occurred_at: "2026-09-16T11:50:30.619Z",
      utm: { source: "canalpro", medium: "portal", content: "87027856" },
    })
    expect(Object.keys(payload)).not.toContain("email")
    expect(Object.keys(payload)).not.toContain("listing_code")
  })
})

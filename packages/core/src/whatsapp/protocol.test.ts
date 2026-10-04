import { describe, expect, it } from "vitest"

import {
  mergeWhatsappStatus,
  WHATSAPP_MESSAGE_STATUS_LABELS,
  WHATSAPP_MESSAGE_STATUSES,
  whatsappError,
  whatsappErrorSuppresses,
  whatsappMessageDelivered,
  whatsappMessageFailed,
  whatsappMessageInFlight,
  whatsappQualityRequiresSuspension,
  WHATSAPP_BLOCK_REASON_MESSAGES,
  WHATSAPP_BLOCK_REASONS,
  whatsappBlockReasonMessage,
  type WhatsappMessageStatus,
} from "./protocol"

describe("mergeWhatsappStatus", () => {
  it("avança quando o webhook traz um estado mais adiantado", () => {
    expect(mergeWhatsappStatus("queued", "accepted")).toBe("accepted")
    expect(mergeWhatsappStatus("accepted", "sent")).toBe("sent")
    expect(mergeWhatsappStatus("sent", "delivered")).toBe("delivered")
    expect(mergeWhatsappStatus("delivered", "read")).toBe("read")
  })

  it("nunca anda para trás com webhook atrasado", () => {
    expect(mergeWhatsappStatus("delivered", "sent")).toBe("delivered")
    expect(mergeWhatsappStatus("read", "delivered")).toBe("read")
    expect(mergeWhatsappStatus("accepted", "queued")).toBe("accepted")
  })

  it("trata falha e descarte como definitivos", () => {
    expect(mergeWhatsappStatus("failed", "delivered")).toBe("failed")
    expect(mergeWhatsappStatus("discarded", "read")).toBe("discarded")
    expect(mergeWhatsappStatus("sent", "failed")).toBe("failed")
    expect(mergeWhatsappStatus("held", "discarded")).toBe("discarded")
  })
})

describe("a tela não pode dizer entregue antes da hora", () => {
  it("só delivered, read e played contam como entrega", () => {
    const entregues = WHATSAPP_MESSAGE_STATUSES.filter(whatsappMessageDelivered)
    expect(entregues).toEqual(["delivered", "read", "played"])
  })

  it("aceita pela Meta e enviada ainda estão em voo, não entregues", () => {
    for (const status of ["queued", "accepted", "held", "sent"] as WhatsappMessageStatus[]) {
      expect(whatsappMessageInFlight(status)).toBe(true)
      expect(whatsappMessageDelivered(status)).toBe(false)
    }
  })

  it("o rótulo de accepted não usa a palavra Entregue", () => {
    expect(WHATSAPP_MESSAGE_STATUS_LABELS.accepted).toBe("Aceita pela Meta")
    expect(WHATSAPP_MESSAGE_STATUS_LABELS.sent).toBe("Enviada")
    expect(WHATSAPP_MESSAGE_STATUS_LABELS.delivered).toBe("Entregue")
    expect(WHATSAPP_MESSAGE_STATUS_LABELS.discarded).toBe("Descartada pela Meta")
  })

  it("todo estado tem rótulo", () => {
    for (const status of WHATSAPP_MESSAGE_STATUSES) {
      expect(WHATSAPP_MESSAGE_STATUS_LABELS[status]).toBeTruthy()
    }
  })

  it("failed e discarded são falha", () => {
    expect(whatsappMessageFailed("failed")).toBe(true)
    expect(whatsappMessageFailed("discarded")).toBe(true)
    expect(whatsappMessageFailed("delivered")).toBe(false)
  })
})

describe("erros que o produto trata por nome", () => {
  it("131049: limite por usuário, esperar antes de reenviar", () => {
    expect(whatsappError(131049)).toMatchObject({ handling: "backoff", dropped: true })
  })

  it("131050: o contato desligou divulgação, vai para a supressão", () => {
    expect(whatsappErrorSuppresses(131050)).toBe(true)
    expect(whatsappErrorSuppresses(131049)).toBe(false)
  })

  it("132015: template pausado, as retidas são descartadas e o texto diz isso", () => {
    const error = whatsappError(132015)
    expect(error).toMatchObject({ handling: "fix_content", dropped: true })
    expect(error?.message).toContain("DESCARTADAS")
  })

  it("código desconhecido não inventa tratamento", () => {
    expect(whatsappError(999999)).toBeNull()
    expect(whatsappError(null)).toBeNull()
    expect(whatsappErrorSuppresses(undefined)).toBe(false)
  })
})

describe("qualidade do número", () => {
  it("só RED suspende o envio", () => {
    expect(whatsappQualityRequiresSuspension("RED")).toBe(true)
    expect(whatsappQualityRequiresSuspension("YELLOW")).toBe(false)
    expect(whatsappQualityRequiresSuspension("GREEN")).toBe(false)
    expect(whatsappQualityRequiresSuspension("UNKNOWN")).toBe(false)
  })
})

describe("motivos de bloqueio do envio", () => {
  it("todo motivo tem tradução em pt-BR", () => {
    for (const reason of WHATSAPP_BLOCK_REASONS) {
      expect(WHATSAPP_BLOCK_REASON_MESSAGES[reason].length).toBeGreaterThan(10)
    }
  })

  it("motivo desconhecido não vaza texto do banco", () => {
    expect(whatsappBlockReasonMessage("erro_qualquer_do_banco")).toBe(
      "Não foi possível enviar agora. Tente de novo."
    )
    expect(whatsappBlockReasonMessage(null)).toBe("Não foi possível enviar agora. Tente de novo.")
  })

  it("a janela fechada explica o que fazer, não só o que falhou", () => {
    expect(whatsappBlockReasonMessage("janela_de_24h_fechada")).toContain("modelo aprovado")
  })
})

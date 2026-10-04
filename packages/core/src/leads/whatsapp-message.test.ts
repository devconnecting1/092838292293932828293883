import { describe, expect, it } from "vitest"

import {
  buildLeadWhatsappMessage,
  findUnknownTemplateVariables,
  LEAD_WHATSAPP_MESSAGE_MAX_LENGTH,
  leadFirstName,
  renderWhatsappTemplate,
  whatsappPropertyLabel,
  withWhatsappText,
} from "./whatsapp-message"

describe("leadFirstName", () => {
  it("usa só o primeiro nome, com a inicial maiúscula", () => {
    expect(leadFirstName("  MARIA   da Silva ")).toBe("Maria")
    expect(leadFirstName("joão")).toBe("João")
  })

  it("sem nome devolve vazio", () => {
    expect(leadFirstName(null)).toBe("")
    expect(leadFirstName("   ")).toBe("")
  })
})

describe("buildLeadWhatsappMessage", () => {
  it("cita o nome do lead, quem fala e o imóvel de interesse", () => {
    expect(
      buildLeadWhatsappMessage({
        leadName: "Maria da Silva",
        senderName: "Carlos Souza",
        property: { code: "IMV-000123", title: "Apartamento 2 quartos" },
      })
    ).toBe(
      "Olá, Maria! Aqui é Carlos Souza. Vi seu interesse no imóvel Apartamento 2 quartos (código IMV-000123). Posso te ajudar com mais informações ou agendar uma visita?"
    )
  })

  it("sem imóvel, oferece ajuda para encontrar um", () => {
    expect(buildLeadWhatsappMessage({ leadName: "Pedro", senderName: null })).toBe(
      "Olá, Pedro! Recebi seu contato e quero te ajudar a encontrar o imóvel certo. Podemos conversar?"
    )
  })

  it("funciona sem nome e só com o código do imóvel", () => {
    expect(buildLeadWhatsappMessage({ leadName: "", property: { code: "IMV-9" } })).toBe(
      "Olá! Vi seu interesse no imóvel de código IMV-9. Posso te ajudar com mais informações ou agendar uma visita?"
    )
  })

  it("nunca passa do teto", () => {
    const message = buildLeadWhatsappMessage({
      leadName: "Ana",
      senderName: "x".repeat(500),
      property: { title: "y".repeat(5000) },
    })

    expect(message.length).toBeLessThanOrEqual(LEAD_WHATSAPP_MESSAGE_MAX_LENGTH)
  })
})

describe("withWhatsappText", () => {
  const href = "https://wa.me/5511988887777"

  it("codifica o texto no parâmetro text", () => {
    expect(withWhatsappText(href, "Olá, Maria! Tudo bem? 50% & mais")).toBe(
      `${href}?text=Ol%C3%A1%2C%20Maria!%20Tudo%20bem%3F%2050%25%20%26%20mais`
    )
  })

  it("texto vazio mantém o link sem mensagem", () => {
    expect(withWhatsappText(href, "   ")).toBe(href)
    expect(withWhatsappText(href, null)).toBe(href)
  })
})
describe("renderWhatsappTemplate", () => {
  it("troca as quatro variáveis, sem diferenciar acento e maiúsculas", () => {
    expect(
      renderWhatsappTemplate("Olá, {nome}! Aqui é {corretor}. Segue o {Imóvel}: {link}", {
        nome: "Maria",
        corretor: "Carlos",
        imovel: whatsappPropertyLabel({ code: "IMV-1", title: "Casa 3 quartos" }),
        link: "https://exemplo.com/imovel/imob/IMV-1",
      })
    ).toBe(
      "Olá, Maria! Aqui é Carlos. Segue o Casa 3 quartos (código IMV-1): https://exemplo.com/imovel/imob/IMV-1"
    )
  })

  it("variável sem valor sai sem deixar pontuação solta nem espaço duplo", () => {
    expect(renderWhatsappTemplate("Olá, {nome}! Tudo bem?  {link}", {})).toBe("Olá! Tudo bem?")
    expect(renderWhatsappTemplate("Oi {nome}, confirmo a visita.", { nome: "" })).toBe(
      "Oi, confirmo a visita."
    )
  })

  it("mantém as quebras de linha e as chaves desconhecidas", () => {
    expect(renderWhatsappTemplate("Olá, {nome}!\n\nDocumentos: {telefone}", { nome: "Ana" })).toBe(
      "Olá, Ana!\n\nDocumentos: {telefone}"
    )
  })

  it("não passa do teto do link", () => {
    expect(renderWhatsappTemplate("x".repeat(1200), {})).toHaveLength(
      LEAD_WHATSAPP_MESSAGE_MAX_LENGTH
    )
  })
})

describe("findUnknownTemplateVariables", () => {
  it("aponta só as variáveis que não existem", () => {
    expect(
      findUnknownTemplateVariables("{nome} {IMÓVEL} {corretor} {link} {telefone} {cpf}")
    ).toEqual(["{telefone}", "{cpf}"])
  })
})

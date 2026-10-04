import { describe, expect, it } from "vitest"

import { DEFAULT_BRAND_COLOR } from "./sanitize"
import {
  AUTHORIZATION_EMAIL_MAX_ITEMS,
  authorizationExpiringEmail,
  captureRequestEmail,
  EmailTemplateError,
  LEAD_SLA_NOTICE_KINDS,
  leadSlaNoticeEmail,
  newLeadEmail,
  referralNoticeEmail,
  subscriptionNoticeEmail,
  teamInvitationEmail,
} from "./templates"

const ORIGIN = "https://imob-teste.seucrm.com.br"
const LEAD_ID = "3f0c1a2b-4d5e-4f60-8a7b-9c0d1e2f3a4b"
const LINE_SEPARATOR = String.fromCharCode(0x2028)
const PARAGRAPH_SEPARATOR = String.fromCharCode(0x2029)

function lead(overrides: Partial<Parameters<typeof newLeadEmail>[0]["lead"]> = {}) {
  return newLeadEmail({
    origin: ORIGIN,
    brand: { name: "Imobiliária Teste", primaryColor: "#123456" },
    recipientName: "Carla Souza",
    lead: {
      id: LEAD_ID,
      name: "Maria Silva",
      source: "landing_page",
      landingPageName: "Lançamento Jardins",
      phone: "11987654321",
      interest: "buy",
      receivedAt: "2026-09-15T17:30:00Z",
      ...overrides,
    },
  })
}

describe("escape de dados do usuário", () => {
  it("escapa <script> no HTML e não deixa tags no texto puro", () => {
    const email = lead({ name: '<script>alert("x")</script>' })

    expect(email.html).not.toContain("<script>")
    expect(email.html).toContain("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;")
    expect(email.subject).not.toMatch(/[\r\n]/)
    // Texto puro não é interpretado: o nome aparece literal, sem marcação do layout.
    expect(email.text).toContain('<script>alert("x")</script>')
    expect(email.text).not.toMatch(/<(p|table|td|a|br|h1)\b/i)
  })

  it("escapa aspas simples, duplas e crase em conteúdo e atributos", () => {
    const email = lead({ name: `O'Brien "Zé" \`x\``, landingPageName: `" onmouseover="alert(1)` })

    expect(email.html).toContain("O&#39;Brien &quot;Zé&quot; &#96;x&#96;")
    expect(email.html).not.toContain('" onmouseover="')
    expect(email.html).toContain("&quot; onmouseover=&quot;alert(1)")
  })

  it("remove U+2028/U+2029 e caracteres de controle do assunto, HTML e texto", () => {
    const email = lead({
      name: `Ana${LINE_SEPARATOR}Maria${PARAGRAPH_SEPARATOR}\u0000\u202eSouza`,
    })

    for (const part of [email.subject, email.html, email.text]) {
      expect(part).not.toContain(LINE_SEPARATOR)
      expect(part).not.toContain(PARAGRAPH_SEPARATOR)
      expect(part).not.toContain("\u0000")
      expect(part).not.toContain("\u202e")
    }

    expect(email.subject).toContain("Ana Maria Souza")
  })

  it("não aceita cor da marca fora do formato hexadecimal", () => {
    const email = newLeadEmail({
      origin: ORIGIN,
      brand: { name: "Imob", primaryColor: "red;background:url(https://evil.example/x)" },
      lead: { name: "Maria" },
    })

    expect(email.html).not.toContain("evil.example")
    expect(email.html).toContain(DEFAULT_BRAND_COLOR)
  })
})

describe("links", () => {
  it("rejeita javascript: e outros esquemas no link do convite", () => {
    const base = {
      origin: ORIGIN,
      organizationName: "Imobiliária Teste",
      role: "broker",
      expiresAt: "2026-09-22T12:00:00Z",
    }

    for (const invitationUrl of [
      "javascript:alert(1)",
      " JaVaScRiPt:alert(1)",
      "data:text/html,<script>alert(1)</script>",
      "//evil.example/convite",
      "http://evil.example/convite",
    ]) {
      expect(() => teamInvitationEmail({ ...base, invitationUrl })).toThrow(EmailTemplateError)
    }
  })

  it("recusa origem que não seja https (ou http em localhost)", () => {
    expect(() => newLeadEmail({ origin: "javascript:alert(1)", lead: { name: "Maria" } })).toThrow(
      EmailTemplateError
    )
    expect(() => newLeadEmail({ origin: "http://imob.example", lead: { name: "Maria" } })).toThrow(
      EmailTemplateError
    )
    expect(
      newLeadEmail({ origin: "http://imob.localhost:3000", lead: { name: "Maria" } }).text
    ).toContain("http://imob.localhost:3000/leads")
  })

  it("aponta para /leads/{id} e cai no funil sem id válido", () => {
    expect(lead().html).toContain(`${ORIGIN}/leads/${LEAD_ID}`)
    expect(lead().text).toContain(`${ORIGIN}/leads/${LEAD_ID}`)
    expect(lead({ id: "../../admin" }).text).toContain(`${ORIGIN}/leads\n`)
  })
})

describe("novo lead", () => {
  it("assunto curto e estável", () => {
    expect(lead().subject).toMatchInlineSnapshot(`"Novo lead: Maria Silva — responda agora"`)
  })

  it("mostra origem, landing page, interesse e telefone mascarado; enfatiza responder rápido", () => {
    const { html, text } = lead()

    expect(text).toContain("Origem: Landing page")
    expect(text).toContain("Landing page: Lançamento Jardins")
    expect(text).toContain("Interesse: Comprar")
    expect(text).toContain("Telefone: (11) *****-4321")
    expect(text).not.toContain("987654321")
    expect(html).not.toContain("987654321")
    expect(text).toContain("Responda nos próximos minutos")
    expect(text).toContain("Olá, Carla!")
    expect(text).toContain("Você recebeu este e-mail porque é responsável por este lead")
  })

  it("HTML de e-mail: idioma, modo escuro, tabelas e sem imagens", () => {
    const { html } = lead()

    expect(html).toContain('<html lang="pt-BR"')
    expect(html).toContain('<meta name="color-scheme" content="light dark">')
    expect(html).toContain("prefers-color-scheme: dark")
    expect(html).toContain('role="presentation"')
    expect(html).not.toMatch(/<img\b/i)
    expect(html).toContain("#123456")
  })
})

describe("nova solicitação de captação", () => {
  it("assunto com tipo e local, link para /captacao e sem dados do proprietário", () => {
    const email = captureRequestEmail({
      origin: ORIGIN,
      brand: { name: "Imobiliária Teste" },
      request: {
        propertyType: "apartment",
        purpose: "sale",
        neighborhood: "Centro",
        city: "Campinas",
        state: "sp",
      },
    })

    expect(email.subject).toMatchInlineSnapshot(
      `"Nova solicitação de captação: Apartamento em Centro, Campinas/SP"`
    )
    expect(email.text).toContain(`${ORIGIN}/captacao`)
    expect(email.text).toContain("Finalidade: Venda")
    expect(email.text).toContain("dono, gerente ou captador")
  })

  it("tipo desconhecido não vira texto livre", () => {
    const email = captureRequestEmail({
      origin: ORIGIN,
      request: { propertyType: "<b>castelo</b>" },
    })

    expect(email.subject).toBe("Nova solicitação de captação: imóvel")
    expect(email.html).not.toContain("castelo")
  })
})

describe("convite para a equipe", () => {
  it("mostra quem convidou, imobiliária, papel e validade", () => {
    const email = teamInvitationEmail({
      origin: ORIGIN,
      organizationName: "Imobiliária Teste",
      inviterName: "João Pereira",
      role: "broker",
      invitationUrl: `${ORIGIN}/convite/abc123`,
      expiresAt: "2026-09-22T15:00:00Z",
    })

    expect(email.subject).toMatchInlineSnapshot(
      `"João Pereira convidou você para o CRM de Imobiliária Teste"`
    )
    expect(email.text).toContain("Papel: Corretor")
    expect(email.text).toContain("Válido até: 22 de setembro de 2026")
    expect(email.text).toContain(`Aceitar convite: ${ORIGIN}/convite/abc123`)
  })
})

describe("aviso de assinatura", () => {
  const base = {
    origin: ORIGIN,
    organizationName: "Imobiliária Teste",
    date: "2026-09-30T12:00:00Z",
  }

  it("quatro tipos, sempre com link para /configuracoes/assinatura", () => {
    const trial = subscriptionNoticeEmail({ ...base, kind: "trial_ending" })
    const failed = subscriptionNoticeEmail({ ...base, kind: "payment_failed" })
    const canceled = subscriptionNoticeEmail({ ...base, kind: "canceled" })
    const readOnly = subscriptionNoticeEmail({ ...base, kind: "read_only" })

    expect(trial.subject).toMatchInlineSnapshot(
      `"O teste gratuito de Imobiliária Teste termina em 30 de setembro de 2026"`
    )
    expect(failed.subject).toMatchInlineSnapshot(
      `"Não conseguimos cobrar a assinatura de Imobiliária Teste"`
    )
    expect(canceled.subject).toMatchInlineSnapshot(
      `"A assinatura de Imobiliária Teste foi cancelada"`
    )
    expect(readOnly.subject).toMatchInlineSnapshot(`"Sua conta está em modo somente leitura"`)

    for (const email of [trial, failed, canceled, readOnly]) {
      expect(email.text).toContain(`${ORIGIN}/configuracoes/assinatura`)
      expect(email.text).toContain("responsável pela assinatura")
    }
  })

  it("somente leitura: explica o que continua e o que fica bloqueado, com a data", () => {
    const { html, text } = subscriptionNoticeEmail({ ...base, kind: "read_only" })

    expect(text).toContain("somente leitura desde 30 de setembro de 2026")
    expect(text).toContain("ver e exportar tudo")
    expect(text).toContain("landing pages e os formulários continuam recebendo leads")
    expect(text).toContain("Não é possível criar nem editar registros até regularizar")
    expect(text).toContain("Nenhum dado foi apagado.")
    expect(text).toContain(`Regularizar assinatura: ${ORIGIN}/configuracoes/assinatura`)
    expect(html).toContain(`href="${ORIGIN}/configuracoes/assinatura"`)
    expect(subscriptionNoticeEmail({ ...base, date: null, kind: "read_only" }).text).toContain(
      "está em modo somente leitura."
    )
  })

  it("tipo inválido lança erro", () => {
    expect(() =>
      subscriptionNoticeEmail({ ...base, kind: "refund" as unknown as "canceled" })
    ).toThrow(EmailTemplateError)
  })
})

describe("aviso de indicação", () => {
  const base = {
    origin: ORIGIN,
    recipientName: "Carla Souza",
    organizationName: "Imobiliária Teste",
    referredName: "Imobiliária J.",
    discountPercent: 30,
    discountApplied: true,
  }

  it("confirmada: informa a indicada, o novo desconto e o link das indicações", () => {
    const { subject, html, text } = referralNoticeEmail({ ...base, kind: "confirmed" })

    expect(subject).toBe("Indicação confirmada: seu desconto agora é de 30%")
    expect(text).toContain("Imobiliária J. completou 30 dias de assinatura paga")
    expect(text).toContain("Seu desconto por indicações agora é de 30%")
    expect(text).toContain(`Ver minhas indicações: ${ORIGIN}/configuracoes/indicacoes`)
    expect(html).toContain(`href="${ORIGIN}/configuracoes/indicacoes"`)
  })

  it("perdida: explica que o desconto diminuiu e fica a aplicar sem assinatura ativa", () => {
    const { subject, text } = referralNoticeEmail({
      ...base,
      kind: "lost",
      discountPercent: 10,
      discountApplied: false,
    })

    expect(subject).toBe("Uma indicação deixou de contar: seu desconto agora é de 10%")
    expect(text).toContain("não está mais com a assinatura ativa")
    expect(text).toContain("passa a valer quando a assinatura de Imobiliária Teste estiver ativa")
    expect(text).toContain("A aplicar")
  })

  it("limita o percentual e usa texto padrão sem o nome da indicada", () => {
    const { subject, text } = referralNoticeEmail({
      ...base,
      kind: "confirmed",
      referredName: null,
      discountPercent: 250,
    })

    expect(subject).toContain("100%")
    expect(text).toContain("Uma imobiliária indicada completou")
  })

  it("tipo inválido lança erro", () => {
    expect(() => referralNoticeEmail({ ...base, kind: "bonus" as unknown as "confirmed" })).toThrow(
      EmailTemplateError
    )
  })
})

describe("aviso de SLA do rodízio de leads", () => {
  const base = {
    origin: ORIGIN,
    brand: { name: "Imobiliária Teste" },
    recipientName: "Carla Souza",
    lead: {
      id: LEAD_ID,
      name: "Maria Silva",
      source: "portal",
      interest: "buy",
      phone: "11987654321",
      receivedAt: "2026-09-15T17:30:00Z",
    },
    slaMinutes: 30,
    dueAt: "2026-09-15T18:00:00Z",
  }

  it("exporta os quatro tipos de aviso", () => {
    expect(LEAD_SLA_NOTICE_KINDS).toEqual([
      "sla_warning",
      "sla_reassigned",
      "sla_lost",
      "sla_breached",
    ])
  })

  it("prazo estourado sem outro corretor: aviso para a gestão, com quem ficou o lead", () => {
    const { subject, text, html } = leadSlaNoticeEmail({
      ...base,
      kind: "sla_breached",
      assigneeName: "Bruno Lima",
    })

    expect(subject).toBe("Lead sem atendimento no prazo: Maria Silva")
    expect(text).toContain("Olá, Carla!")
    expect(text).toContain(
      "O lead Maria Silva passou do prazo de primeiro contato e não havia outro corretor disponível no rodízio. Ele continua com Bruno Lima."
    )
    expect(text).toContain("Responsável: Bruno Lima")
    expect(text).toContain(`${ORIGIN}/leads/${LEAD_ID}`)
    expect(text).toContain("faz a gestão da equipe de Imobiliária Teste")
    // A gestão acompanha pelo CRM: o e-mail não traz nem o telefone mascarado.
    expect(text).not.toContain("Telefone")
    expect(html).not.toContain("987654321")
  })

  it("prazo estourado sem o nome do responsável usa o texto genérico", () => {
    const { text } = leadSlaNoticeEmail({ ...base, kind: "sla_breached", assigneeName: "  " })

    expect(text).toContain("Ele continua com o corretor responsável.")
    expect(text).not.toContain("Responsável:")
  })

  it("prazo acabando: assunto com os minutos restantes e link do lead", () => {
    const { subject, text, html } = leadSlaNoticeEmail({
      ...base,
      kind: "sla_warning",
      minutesLeft: 8,
    })

    expect(subject).toBe("Faltam 8 min para responder o lead Maria Silva")
    expect(text).toContain("Olá, Carla!")
    expect(text).toContain("Você é o corretor responsável pelo lead Maria Silva")
    expect(text).toContain("O prazo de primeiro contato é de 30 min")
    expect(text).toContain("Prazo de primeiro contato: 30 min")
    expect(text).toContain("Responder até: 15 de setembro de 2026")
    expect(text).toContain("Origem: Portal")
    expect(text).toContain("Interesse: Comprar")
    expect(text).toContain(`Abrir o lead no CRM: ${ORIGIN}/leads/${LEAD_ID}`)
    expect(html).toContain(`href="${ORIGIN}/leads/${LEAD_ID}"`)
  })

  it("repassado: o novo dono recebe o lead com o prazo dele", () => {
    const { subject, text, html } = leadSlaNoticeEmail({
      ...base,
      kind: "sla_reassigned",
      recipientName: "Bruno Lima",
    })

    expect(subject).toBe("Lead Maria Silva é seu: responda em até 30 min")
    expect(text).toContain("Olá, Bruno!")
    expect(text).toContain("o primeiro contato não foi feito dentro do prazo")
    expect(text).toContain("Seu prazo de primeiro contato começa agora e é de 30 min")
    expect(text).toContain(`Abrir o lead no CRM: ${ORIGIN}/leads/${LEAD_ID}`)
    expect(html).toContain(`href="${ORIGIN}/leads/${LEAD_ID}"`)
  })

  it("perdido: explica o rodízio, manda para /leads e não leva o contato do lead", () => {
    const { subject, text, html } = leadSlaNoticeEmail({ ...base, kind: "sla_lost" })

    expect(subject).toBe("O lead Maria Silva foi repassado")
    expect(text).toContain("foi repassado para outro corretor da equipe")
    expect(text).toContain("passa para o próximo corretor da fila")
    expect(text).toContain("Prazo terminou em: 15 de setembro de 2026")
    expect(text).toContain(`Ver meus leads: ${ORIGIN}/leads`)
    expect(text).not.toContain(`/leads/${LEAD_ID}`)
    expect(html).not.toContain(`/leads/${LEAD_ID}`)
    expect(text).not.toContain("Telefone")
    expect(text).not.toContain("4321")
  })

  it("sem id válido o link cai no funil, em qualquer tipo", () => {
    for (const kind of LEAD_SLA_NOTICE_KINDS) {
      const { text, html } = leadSlaNoticeEmail({
        ...base,
        kind,
        lead: { ...base.lead, id: "../../admin" },
      })

      expect(text).toContain(`${ORIGIN}/leads\n`)
      expect(text).not.toContain("admin")
      expect(html).not.toContain("admin")
    }
  })

  it("telefone sempre mascarado e nunca completo", () => {
    for (const kind of LEAD_SLA_NOTICE_KINDS) {
      const { html, text } = leadSlaNoticeEmail({ ...base, kind })

      expect(text).not.toContain("987654321")
      expect(html).not.toContain("987654321")
    }

    for (const kind of ["sla_warning", "sla_reassigned"] as const) {
      expect(leadSlaNoticeEmail({ ...base, kind }).text).toContain("Telefone: (11) *****-4321")
    }
  })

  it("prazo inválido não vira texto: cai no aviso genérico", () => {
    for (const slaMinutes of [0, -30, 5000, Number.NaN, Number.POSITIVE_INFINITY]) {
      const warning = leadSlaNoticeEmail({ ...base, kind: "sla_warning", slaMinutes, dueAt: null })
      const reassigned = leadSlaNoticeEmail({ ...base, kind: "sla_reassigned", slaMinutes })

      expect(warning.text).toContain("Faça o primeiro contato o quanto antes")
      expect(warning.text).not.toMatch(/\d+ min/)
      expect(warning.text).not.toMatch(/NaN|Infinity/)
      expect(reassigned.subject).toBe("Lead Maria Silva é seu: responda agora")
      expect(reassigned.text).not.toMatch(/\d+ min/)
    }

    expect(leadSlaNoticeEmail({ ...base, kind: "sla_reassigned", slaMinutes: 1440 }).subject).toBe(
      "Lead Maria Silva é seu: responda em até 1440 min"
    )
    expect(leadSlaNoticeEmail({ ...base, kind: "sla_reassigned", slaMinutes: 30.9 }).subject).toBe(
      "Lead Maria Silva é seu: responda em até 30 min"
    )
  })

  it("minutos restantes inválidos ou fora da faixa não aparecem no assunto", () => {
    expect(leadSlaNoticeEmail({ ...base, kind: "sla_warning", minutesLeft: 0 }).subject).toBe(
      "Faltam menos de 1 min para responder o lead Maria Silva"
    )

    for (const minutesLeft of [-1, 1441, Number.NaN, Number.NEGATIVE_INFINITY, null]) {
      const { subject, text } = leadSlaNoticeEmail({ ...base, kind: "sla_warning", minutesLeft })

      expect(subject).toBe("O prazo de resposta do lead Maria Silva está acabando")
      expect(text).not.toMatch(/Faltam/)
      expect(text).not.toMatch(/NaN|Infinity/)
      expect(subject).not.toMatch(/[0-9]/)
    }
  })

  it("nunca cita o corretor anterior", () => {
    const previous = { name: "João Pereira", email: "joao.pereira@imob.example" }
    // O template não tem por onde receber o corretor anterior: nome e e-mail
    // dele são dados de outra pessoa e não podem aparecer para o novo dono.
    const email = leadSlaNoticeEmail({
      ...base,
      kind: "sla_reassigned" as const,
      recipientName: "Bruno Lima",
      previousBrokerName: previous.name,
      previousBrokerEmail: previous.email,
    } as Parameters<typeof leadSlaNoticeEmail>[0])

    for (const part of [email.subject, email.text, email.html]) {
      expect(part).not.toContain(previous.name)
      expect(part).not.toContain(previous.email)
      expect(part).not.toContain("imob.example")
      expect(part).not.toContain("Carla")
    }
  })

  it("tipo inválido lança erro", () => {
    expect(() =>
      leadSlaNoticeEmail({ ...base, kind: "sla_ok" as unknown as "sla_warning" })
    ).toThrow(EmailTemplateError)
  })
})

describe("aviso de autorização vencendo", () => {
  const PROPERTY_ID = "7b1f2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d"
  const item = {
    propertyId: PROPERTY_ID,
    code: "IMV-000123",
    title: "Cobertura no Itaim",
    neighborhood: "Itaim Bibi",
    city: "São Paulo",
    endsOn: "2026-09-23",
    daysLeft: 7,
    exclusive: true,
  }
  const base = {
    origin: ORIGIN,
    brand: { name: "Imobiliária Teste", primaryColor: "#123456" },
    recipientName: "Carla Souza",
    items: [item],
  }

  it("um imóvel: assunto com o prazo, data sem mudar de dia e link para a aba Autorização", () => {
    const { subject, text, html } = authorizationExpiringEmail(base)

    expect(subject).toBe("Autorização do imóvel IMV-000123 vence em 7 dias")
    expect(text).toContain("Olá, Carla!")
    expect(text).toContain("23 de setembro de 2026")
    expect(text).not.toContain("22 de setembro")
    expect(text).toContain("Exclusividade: Sim")
    expect(text).toContain(`${ORIGIN}/imoveis/${PROPERTY_ID}?aba=autorizacao`)
    expect(html).toContain("aba=autorizacao")
    expect(text).toContain("captador ou corretor responsável por este imóvel")
  })

  it("hoje e amanhã", () => {
    expect(authorizationExpiringEmail({ ...base, items: [{ ...item, daysLeft: 0 }] }).subject).toBe(
      "Autorização do imóvel IMV-000123 vence hoje"
    )
    expect(authorizationExpiringEmail({ ...base, items: [{ ...item, daysLeft: 1 }] }).subject).toBe(
      "Autorização do imóvel IMV-000123 vence amanhã"
    )
  })

  it("vários imóveis: um e-mail só, do mais urgente ao menos urgente, com link para a lista", () => {
    const { subject, text } = authorizationExpiringEmail({
      ...base,
      isManager: true,
      items: [
        { ...item, code: "IMV-000200", daysLeft: 30, endsOn: "2026-10-16", exclusive: false },
        { ...item, code: "IMV-000100", daysLeft: 1, endsOn: "2026-09-17" },
      ],
    })

    expect(subject).toBe("2 autorizações de imóveis vencendo: a primeira vence amanhã")
    expect(text.indexOf("IMV-000100")).toBeLessThan(text.indexOf("IMV-000200"))
    expect(text).toContain("IMV-000100: Cobertura no Itaim · Itaim Bibi, São Paulo · vence amanhã")
    expect(text).toContain(`${ORIGIN}/imoveis?autorizacao=vencendo`)
    expect(text).toContain("faz a gestão da equipe")
  })

  it("lista no máximo o teto de imóveis e conta o resto", () => {
    const items = Array.from({ length: AUTHORIZATION_EMAIL_MAX_ITEMS + 3 }, (_, index) => ({
      ...item,
      code: `IMV-${String(index + 1).padStart(6, "0")}`,
    }))
    const { text } = authorizationExpiringEmail({ ...base, items })

    expect(text).toContain("IMV-000020")
    expect(text).not.toContain("IMV-000021:")
    expect(text).toContain("E mais 3 imóveis na lista do CRM.")
  })

  it("ignora prazo fora da janela, data inválida e id malicioso", () => {
    const { subject, text } = authorizationExpiringEmail({
      ...base,
      items: [
        { ...item, code: "IMV-VENCIDO", daysLeft: -1 },
        { ...item, code: "IMV-LONGE", daysLeft: 45 },
        { ...item, code: "IMV-DATA", endsOn: "2026-02-31" },
        { ...item, propertyId: "../../admin" },
      ],
    })

    expect(subject).toBe("Autorização do imóvel IMV-000123 vence em 7 dias")
    expect(text).not.toMatch(/IMV-VENCIDO|IMV-LONGE|IMV-DATA|admin/)
    expect(text).toContain(`${ORIGIN}/imoveis?autorizacao=vencendo`)
  })

  it("escapa o título e sem nenhum imóvel válido lança erro", () => {
    const { html } = authorizationExpiringEmail({
      ...base,
      items: [{ ...item, title: '<img src=x onerror="alert(1)">' }],
    })

    expect(html).not.toContain("<img")
    expect(() => authorizationExpiringEmail({ ...base, items: [] })).toThrow(EmailTemplateError)
    expect(() =>
      authorizationExpiringEmail({ ...base, items: [{ ...item, daysLeft: Number.NaN }] })
    ).toThrow(EmailTemplateError)
  })
})

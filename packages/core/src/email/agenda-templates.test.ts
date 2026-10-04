import { describe, expect, it } from "vitest"

import {
  dailyDigestEmail,
  visitAssignedEmail,
  visitReminderEmail,
  visitWhenLabel,
  weeklyReportEmail,
  type DailyDigestEmailParams,
} from "./agenda-templates"
import { visitCalendarPath } from "./reminders"
import { EmailTemplateError } from "./templates"

const ORIGIN = "https://imob-teste.seucrm.com.br"
const VISIT_ID = "3f0c1a2b-4d5e-4f60-8a7b-9c0d1e2f3a4b"
const LEAD_ID = "7a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d"
const CLIENT_ID = "0b1c2d3e-4f5a-4b6c-9d7e-8f9a0b1c2d3e"
const NOW = new Date("2026-09-16T10:00:00.000Z")

function digest(overrides: Partial<DailyDigestEmailParams> = {}) {
  return dailyDigestEmail({
    origin: ORIGIN,
    brand: { name: "Imobiliária Teste", primaryColor: "#123456" },
    recipientName: "Carla Souza",
    date: "2026-09-16",
    now: NOW,
    tasksOverdue: {
      items: [{ title: "Ligar para o Sr. João", dueAt: "2026-09-15T13:00:00Z" }],
      total: 1,
    },
    tasksToday: {
      items: [
        { title: "Enviar proposta", dueAt: "2026-09-16T18:00:00Z" },
        { title: "Sem horário", dueAt: "2026-09-17T02:59:00Z" },
      ],
      total: 2,
    },
    visits: {
      items: [
        {
          id: VISIT_ID,
          startsAt: "2026-09-16T17:30:00Z",
          endsAt: "2026-09-16T18:30:00Z",
          propertyCode: "IMV-000123",
          propertyTitle: "Apartamento 2 quartos",
          address: "Rua das Flores — Centro, São Paulo/SP",
          meetingPoint: "Portaria",
          clientFirstName: "Maria",
        },
      ],
      total: 1,
    },
    staleLeads: {
      items: [
        {
          id: LEAD_ID,
          name: "Pedro Lima",
          stage: "contacted",
          lastContactAt: "2026-09-11T10:00:00Z",
        },
      ],
      total: 4,
      days: 3,
    },
    birthdays: { items: [{ id: CLIENT_ID, name: "Ana Paula", age: 41 }], total: 1 },
    ...overrides,
  })
}

describe("dailyDigestEmail", () => {
  it("resume o dia no assunto e lista cada seção com links do CRM", () => {
    const email = digest()

    expect(email.subject).toBe(
      "Seu dia: 1 visita, 3 tarefas, 4 leads sem contato e 1 aniversariante"
    )
    expect(email.html).toContain("Visitas de hoje")
    expect(email.html).toContain("14:30–15:30 · IMV-000123 · Apartamento 2 quartos")
    expect(email.html).toContain(
      "Rua das Flores — Centro, São Paulo/SP · Encontro: Portaria · Cliente: Maria"
    )
    expect(email.html).toContain("Tarefas atrasadas")
    expect(email.html).toContain("Venceu em 15/09")
    expect(email.html).toContain("Até 15:00")
    expect(email.html).toContain("Até o fim do dia")
    expect(email.html).toContain("Leads sem contato há mais de 3 dias")
    expect(email.html).toContain("Em contato · sem contato há 5 dias")
    expect(email.html).toContain("E mais 3 no funil de leads.")
    expect(email.html).toContain("Faz 41 anos hoje")
    expect(email.html).toContain(`${ORIGIN}/leads/${LEAD_ID}`)
    expect(email.html).toContain(`${ORIGIN}/clientes/${CLIENT_ID}`)
    expect(email.html).toContain(`${ORIGIN}/agenda?dia=2026-09-16`)
    expect(email.text).toContain("VISITAS DE HOJE")
    expect(email.text).toContain(`${ORIGIN}/tarefas`)
    expect(email.text).toContain("Meu perfil")
  })

  it("não monta e-mail sem conteúdo", () => {
    const empty = { items: [], total: 0 }

    expect(() =>
      digest({
        tasksOverdue: empty,
        tasksToday: empty,
        visits: empty,
        staleLeads: { ...empty, days: 3 },
        birthdays: empty,
      })
    ).toThrow(EmailTemplateError)
  })

  it("escapa dados vindos do banco", () => {
    const email = digest({
      tasksToday: { items: [{ title: '<img src=x onerror="alert(1)">' }], total: 1 },
    })

    expect(email.html).not.toContain("<img src=x")
    expect(email.html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;")
  })

  it("recusa origem inválida", () => {
    expect(() => digest({ origin: "javascript:alert(1)" })).toThrow(EmailTemplateError)
  })
})

describe("visitReminderEmail", () => {
  const visit = {
    id: VISIT_ID,
    startsAt: "2026-09-16T17:30:00Z",
    endsAt: "2026-09-16T18:30:00Z",
    propertyCode: "IMV-000123",
    propertyTitle: "Apartamento 2 quartos",
    address: "Centro, São Paulo/SP",
    meetingPoint: "Portaria do prédio",
    clientFirstName: "Maria",
  }

  it("avisa hora, imóvel, endereço e traz o link do convite", () => {
    const email = visitReminderEmail({ origin: ORIGIN, recipientName: "Carla", visit, now: NOW })

    expect(email.subject).toBe("Visita hoje às 14:30: IMV-000123 · Apartamento 2 quartos")
    expect(email.html).toContain("Você tem uma visita hoje às 14:30 com Maria")
    expect(email.html).toContain("Ponto de encontro: Portaria do prédio")
    expect(email.html).toContain("Centro, São Paulo/SP")
    expect(email.html).toContain(`${ORIGIN}${visitCalendarPath(VISIT_ID)}`)
    expect(email.html).toContain("Adicionar ao Google Agenda / Outlook")
    expect(email.text).toContain(`${ORIGIN}/agenda/visitas/${VISIT_ID}/convite`)
  })

  it("diz amanhã quando a visita é no dia seguinte", () => {
    const email = visitReminderEmail({
      origin: ORIGIN,
      visit: { ...visit, startsAt: "2026-09-17T03:30:00Z", endsAt: null },
      now: new Date("2026-09-17T01:30:00Z"),
    })

    expect(email.subject).toContain("Visita amanhã às 00:30")
  })

  it("recusa visita sem id válido", () => {
    expect(() =>
      visitReminderEmail({ origin: ORIGIN, visit: { ...visit, id: "nao-e-uuid" }, now: NOW })
    ).toThrow(EmailTemplateError)
  })
})

describe("weeklyReportEmail", () => {
  it("mostra os totais da semana e uma linha por corretor", () => {
    const email = weeklyReportEmail({
      origin: ORIGIN,
      brand: { name: "Imobiliária Teste" },
      recipientName: "Rogério",
      weekStart: "2026-09-07",
      weekEnd: "2026-09-13",
      totals: {
        leadsReceived: 12,
        leadsAnswered: 10,
        leadsInSla: 6,
        leadsWon: 2,
        leadsLost: 1,
        visitsScheduled: 7,
        visitsDone: 5,
        visitsNoShow: 1,
        proposalsMade: 3,
        proposalsClosed: 1,
        proposalsClosedAmount: 450000,
        brokersWithActivity: 2,
      },
      brokers: [
        {
          name: "Carla Souza",
          leadsReceived: 8,
          firstResponseMedianMinutes: 150,
          visitsDone: 4,
          visitsScheduled: 5,
          proposalsMade: 2,
          proposalsClosed: 1,
          leadsWon: 2,
        },
        {
          name: "João Lima",
          active: false,
          leadsReceived: 4,
          firstResponseMedianMinutes: null,
          visitsDone: 1,
          visitsScheduled: 2,
          proposalsMade: 1,
          proposalsClosed: 0,
          leadsWon: 0,
        },
      ],
    })

    expect(email.subject).toBe("Semana de 07/09 a 13/09: 12 leads, 5 visitas e 2 ganhos")
    expect(email.html).toContain("10 (83%)")
    expect(email.html).toContain("5 de 7 agendadas")
    expect(email.html).toContain("R$ 450.000,00")
    expect(email.html).toContain(
      "8 leads · 1º contato em 2 h 30 min (mediana) · 4 visitas realizadas de 5 · 2 propostas · 2 ganhos"
    )
    expect(email.html).toContain("João Lima (inativo)")
    expect(email.html).toContain(`${ORIGIN}/relatorios?de=2026-09-07&amp;ate=2026-09-13`)
  })

  it("recusa semana inválida", () => {
    expect(() =>
      weeklyReportEmail({
        origin: ORIGIN,
        weekStart: "segunda",
        weekEnd: "2026-09-13",
        totals: {
          leadsReceived: 0,
          leadsAnswered: 0,
          leadsInSla: 0,
          leadsWon: 0,
          leadsLost: 0,
          visitsScheduled: 0,
          visitsDone: 0,
          visitsNoShow: 0,
          proposalsMade: 0,
          proposalsClosed: 0,
          proposalsClosedAmount: 0,
          brokersWithActivity: 0,
        },
        brokers: [],
      })
    ).toThrow(EmailTemplateError)
  })
})

describe("visitAssignedEmail", () => {
  const visit = {
    id: VISIT_ID,
    startsAt: "2026-09-17T12:00:00Z",
    endsAt: "2026-09-17T13:00:00Z",
    propertyCode: "IMV-000321",
    propertyTitle: "Casa com quintal",
    address: "Jardim Paulista, Ribeirão Preto/SP",
    meetingPoint: null,
    clientFirstName: "Pedro",
  }

  it("diz quem marcou, quando e traz o convite", () => {
    const email = visitAssignedEmail({
      origin: ORIGIN,
      recipientName: "Carla",
      assignedByName: "Júlia Assistente",
      visit,
      now: NOW,
    })

    expect(email.subject).toBe(
      "Nova visita para você amanhã às 09:00: IMV-000321 · Casa com quintal"
    )
    expect(email.html).toContain("marcou uma visita para você amanhã às 09:00 com Pedro")
    expect(email.text).toContain("Júlia Assistente")
    expect(email.html).toContain(`${ORIGIN}${visitCalendarPath(VISIT_ID)}`)
    expect(email.text).toContain("Meu perfil")
  })

  it("sem nome de quem marcou, fala da equipe", () => {
    const email = visitAssignedEmail({ origin: ORIGIN, visit, now: NOW })

    expect(email.text).toContain("Alguém da equipe marcou uma visita para você")
  })

  it("recusa visita sem horário válido", () => {
    expect(() =>
      visitAssignedEmail({ origin: ORIGIN, visit: { ...visit, startsAt: "amanhã" }, now: NOW })
    ).toThrow(EmailTemplateError)
  })
})

describe("visitWhenLabel", () => {
  it("usa hoje, amanhã ou a data", () => {
    expect(visitWhenLabel("2026-09-16T17:30:00Z", NOW)).toBe("hoje às 14:30")
    expect(visitWhenLabel("2026-09-17T12:00:00Z", NOW)).toBe("amanhã às 09:00")
    expect(visitWhenLabel("2026-09-20T13:00:00Z", NOW)).toBe("em 20/09 às 10:00")
    expect(visitWhenLabel("inválido", NOW)).toBeNull()
  })
})

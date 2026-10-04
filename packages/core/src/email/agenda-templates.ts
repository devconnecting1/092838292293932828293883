// Modelos dos lembretes por e-mail (pt-BR): resumo diário, lembrete de visita e
// relatório semanal ao gestor. Mesmas garantias de templates.ts: todo dado é não
// confiável (limpo e escapado em layout.ts) e os links ficam presos à origem.

import { formatBRL } from "../billing/format"
import { formatMinutes } from "../reports/rates"
import {
  renderEmail,
  resolveBrand,
  type EmailBrand,
  type EmailSection,
  type RenderedEmail,
} from "./layout"
import {
  addDaysToDateKey,
  DAILY_DIGEST_SECTION_LIMIT,
  formatDateKey,
  formatSaoPauloTime,
  isDateKey,
  toSaoPauloDateKey,
  visitCalendarPath,
} from "./reminders"
import { cleanText, isUuid } from "./sanitize"
import { EmailTemplateError, greetingFor, requireLink, requireOrigin } from "./templates"

const numberFormat = new Intl.NumberFormat("pt-BR")

function count(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0
}

function plural(total: number, singular: string, pluralForm: string) {
  return `${numberFormat.format(total)} ${total === 1 ? singular : pluralForm}`
}

function moreNote(total: number, listed: number, where: string) {
  const hidden = total - listed
  return hidden > 0 ? `E mais ${numberFormat.format(hidden)} ${where}.` : null
}

function idOrNull(value: unknown) {
  return isUuid(value) ? value.toLowerCase() : null
}

/** "15 min", "2 h 30 min", "1 d 4 h" (mesma leitura da tela de relatórios). */
function durationLabel(minutes: number | null | undefined) {
  const label = formatMinutes(minutes ?? null)
  return label === "—" ? null : label
}

export const LEAD_STAGE_EMAIL_LABELS = {
  new: "Novo",
  contacted: "Em contato",
  qualified: "Qualificado",
  visit_scheduled: "Visita agendada",
  proposal: "Proposta",
  won: "Ganho",
  lost: "Perdido",
} as const

// (a) Resumo diário ---------------------------------------------------------------

export type DigestTask = { id?: string | null; title: string; dueAt?: string | null }

export type DigestVisit = {
  id?: string | null
  startsAt: string
  endsAt?: string | null
  propertyCode?: string | null
  propertyTitle?: string | null
  /** Já no modo de exibição do imóvel (formatDisplayAddress). */
  address?: string | null
  meetingPoint?: string | null
  clientFirstName?: string | null
}

export type DigestLead = {
  id?: string | null
  name: string
  stage?: string | null
  lastContactAt?: string | null
}

export type DigestBirthday = { id?: string | null; name: string; age?: number | null }

type DigestList<T> = { items: readonly T[]; total: number }

export type DailyDigestEmailParams = {
  origin: string
  brand?: EmailBrand | null
  recipientName?: string | null
  /** Dia do resumo ("AAAA-MM-DD", Brasília). */
  date: string
  tasksOverdue: DigestList<DigestTask>
  tasksToday: DigestList<DigestTask>
  visits: DigestList<DigestVisit>
  staleLeads: DigestList<DigestLead> & { days: number }
  birthdays: DigestList<DigestBirthday>
  /** Para "sem contato há N dias" (padrão: agora). */
  now?: Date
}

function listTotal<T>(list: DigestList<T>) {
  return Math.max(count(list.total), list.items.length)
}

function daysSince(iso: string | null | undefined, now: Date) {
  if (!iso) {
    return null
  }

  const time = Date.parse(iso)
  return Number.isNaN(time) ? null : Math.max(0, Math.floor((now.getTime() - time) / 86_400_000))
}

function visitLine(visit: DigestVisit) {
  const code = cleanText(visit.propertyCode, { maxLength: 30 })
  const title = cleanText(visit.propertyTitle, { maxLength: 100 })
  const property = code && title ? `${code} · ${title}` : code || title || "Imóvel"
  const start = formatSaoPauloTime(visit.startsAt)
  const end = formatSaoPauloTime(visit.endsAt)
  const time = start ? (end ? `${start}–${end}` : start) : null

  return { title: [time, property].filter(Boolean).join(" · "), property }
}

export function dailyDigestEmail(params: DailyDigestEmailParams): RenderedEmail {
  const origin = requireOrigin(params.origin)
  const brand = resolveBrand(params.brand)

  if (!isDateKey(params.date)) {
    throw new EmailTemplateError("Data inválida para o resumo diário.")
  }

  const now = params.now ?? new Date()
  const limit = DAILY_DIGEST_SECTION_LIMIT
  const overdueTotal = listTotal(params.tasksOverdue)
  const todayTotal = listTotal(params.tasksToday)
  const visitsTotal = listTotal(params.visits)
  const leadsTotal = listTotal(params.staleLeads)
  const birthdaysTotal = listTotal(params.birthdays)
  const staleDays = Math.max(1, count(params.staleLeads.days))

  if (overdueTotal + todayTotal + visitsTotal + leadsTotal + birthdaysTotal === 0) {
    throw new EmailTemplateError("Resumo diário sem conteúdo.")
  }

  const tasksUrl = requireLink("/tarefas", origin)
  const agendaUrl = requireLink(`/agenda?dia=${params.date}`, origin)
  const sections: EmailSection[] = []

  if (visitsTotal > 0) {
    const items = params.visits.items.slice(0, limit)
    sections.push({
      title: "Visitas de hoje",
      items: items.map((visit) => {
        const line = visitLine(visit)
        const client = cleanText(visit.clientFirstName, { maxLength: 40 })
        const meeting = cleanText(visit.meetingPoint, { maxLength: 120 })

        return {
          title: line.title,
          meta: [
            cleanText(visit.address, { maxLength: 200 }),
            meeting ? `Encontro: ${meeting}` : null,
            client ? `Cliente: ${client}` : null,
          ]
            .filter(Boolean)
            .join(" · "),
          url: agendaUrl,
        }
      }),
      note: moreNote(visitsTotal, items.length, "na agenda"),
    })
  }

  if (overdueTotal > 0) {
    const items = params.tasksOverdue.items.slice(0, limit)
    sections.push({
      title: "Tarefas atrasadas",
      items: items.map((task) => {
        const dueKey = task.dueAt ? toSaoPauloDateKey(task.dueAt) : null
        const due = dueKey ? formatDateKey(dueKey) : null

        return {
          title: task.title,
          meta: due ? `Venceu em ${due}` : null,
          url: tasksUrl,
        }
      }),
      note: moreNote(overdueTotal, items.length, "em Tarefas"),
    })
  }

  if (todayTotal > 0) {
    const items = params.tasksToday.items.slice(0, limit)
    sections.push({
      title: "Tarefas de hoje",
      items: items.map((task) => {
        const time = formatSaoPauloTime(task.dueAt)
        // 23:59 é o "sem horário" das tarefas.
        return {
          title: task.title,
          meta: time && time !== "23:59" ? `Até ${time}` : "Até o fim do dia",
          url: tasksUrl,
        }
      }),
      note: moreNote(todayTotal, items.length, "em Tarefas"),
    })
  }

  if (leadsTotal > 0) {
    const items = params.staleLeads.items.slice(0, limit)
    sections.push({
      title: `Leads sem contato há mais de ${plural(staleDays, "dia", "dias")}`,
      items: items.map((lead) => {
        const id = idOrNull(lead.id)
        const days = daysSince(lead.lastContactAt, now)
        const stage =
          typeof lead.stage === "string" &&
          Object.prototype.hasOwnProperty.call(LEAD_STAGE_EMAIL_LABELS, lead.stage)
            ? LEAD_STAGE_EMAIL_LABELS[lead.stage as keyof typeof LEAD_STAGE_EMAIL_LABELS]
            : null

        return {
          title: lead.name,
          meta: [stage, days !== null ? `sem contato há ${plural(days, "dia", "dias")}` : null]
            .filter(Boolean)
            .join(" · "),
          url: requireLink(id ? `/leads/${id}` : "/leads", origin),
        }
      }),
      note: moreNote(leadsTotal, items.length, "no funil de leads"),
    })
  }

  if (birthdaysTotal > 0) {
    const items = params.birthdays.items.slice(0, limit)
    sections.push({
      title: "Aniversariantes de hoje",
      items: items.map((birthday) => {
        const id = idOrNull(birthday.id)
        const age = count(birthday.age)

        return {
          title: birthday.name,
          meta: age > 0 ? `Faz ${age} anos hoje` : "Faz aniversário hoje",
          url: requireLink(id ? `/clientes/${id}` : "/clientes", origin),
        }
      }),
      note: moreNote(birthdaysTotal, items.length, "na lista de clientes"),
    })
  }

  const summary = [
    visitsTotal > 0 ? plural(visitsTotal, "visita", "visitas") : null,
    overdueTotal + todayTotal > 0 ? plural(overdueTotal + todayTotal, "tarefa", "tarefas") : null,
    leadsTotal > 0 ? plural(leadsTotal, "lead sem contato", "leads sem contato") : null,
    birthdaysTotal > 0 ? plural(birthdaysTotal, "aniversariante", "aniversariantes") : null,
  ].filter((value): value is string => Boolean(value))
  const summaryText =
    summary.length > 1
      ? `${summary.slice(0, -1).join(", ")} e ${summary[summary.length - 1]}`
      : (summary[0] ?? "")
  const dayLabel = formatDateKey(params.date, "long") ?? params.date

  return renderEmail(params.brand, {
    subject: `Seu dia: ${summaryText}`,
    preheader: `Resumo de ${dayLabel}: o que pede atenção antes de começar.`,
    heading: "Seu resumo do dia",
    greeting: greetingFor(params.recipientName),
    paragraphs: [`Para ${dayLabel} você tem ${summaryText}.`],
    highlight:
      overdueTotal > 0
        ? `${plural(overdueTotal, "tarefa atrasada", "tarefas atrasadas")}: resolva ou reagende primeiro.`
        : null,
    sections,
    action: { label: "Abrir a agenda de hoje", url: agendaUrl },
    secondaryActions: [{ label: "Ver minhas tarefas", url: tasksUrl }],
    closing: [
      'Não quer receber este resumo? Desligue em "Meu perfil", na seção de e-mails automáticos.',
    ],
    footer: `Você recebeu este e-mail porque faz parte da equipe de ${brand.name} no CRM e tem tarefas, visitas, leads ou clientes sob sua responsabilidade.`,
  })
}

// (b) Lembrete de visita ----------------------------------------------------------

export type VisitReminderEmailParams = {
  origin: string
  brand?: EmailBrand | null
  recipientName?: string | null
  visit: DigestVisit & { id: string }
  /** Para dizer "hoje" ou "amanhã" (padrão: agora). */
  now?: Date
}

/** "hoje às 14:30", "amanhã às 09:00" ou "em 20/09/2026 às 10:00" (Brasília). */
export function visitWhenLabel(startsAt: string, now: Date = new Date()): string | null {
  const start = formatSaoPauloTime(startsAt)
  const dayKey = toSaoPauloDateKey(startsAt)

  if (!start || !dayKey) {
    return null
  }

  const todayKey = toSaoPauloDateKey(now)

  return dayKey === todayKey
    ? `hoje às ${start}`
    : todayKey && dayKey === addDaysToDateKey(todayKey, 1)
      ? `amanhã às ${start}`
      : `em ${formatDateKey(dayKey) ?? dayKey} às ${start}`
}

export function visitReminderEmail(params: VisitReminderEmailParams): RenderedEmail {
  const origin = requireOrigin(params.origin)
  const brand = resolveBrand(params.brand)
  const visitId = idOrNull(params.visit.id)
  const start = formatSaoPauloTime(params.visit.startsAt)
  const dayKey = toSaoPauloDateKey(params.visit.startsAt)
  const when = visitWhenLabel(params.visit.startsAt, params.now ?? new Date())

  if (!visitId || !start || !dayKey || !when) {
    throw new EmailTemplateError("Visita inválida para o lembrete.")
  }

  const line = visitLine(params.visit)
  const end = formatSaoPauloTime(params.visit.endsAt)
  const address = cleanText(params.visit.address, { maxLength: 200 })
  const meeting = cleanText(params.visit.meetingPoint, { maxLength: 200 })
  const client = cleanText(params.visit.clientFirstName, { maxLength: 40 })

  return renderEmail(params.brand, {
    subject: `Visita ${when}: ${cleanText(line.property, { maxLength: 60 })}`,
    preheader: address
      ? `${address}. Confira o endereço e o ponto de encontro.`
      : "Confira o imóvel e o ponto de encontro antes de sair.",
    heading: "Lembrete de visita",
    greeting: greetingFor(params.recipientName),
    paragraphs: [
      `Você tem uma visita ${when}${client ? ` com ${client}` : ""} ao imóvel ${line.property}.`,
    ],
    highlight: meeting ? `Ponto de encontro: ${meeting}` : null,
    details: [
      { label: "Horário", value: end ? `${start} às ${end}` : start },
      { label: "Imóvel", value: line.property },
      { label: "Endereço", value: address },
      { label: "Cliente", value: client },
    ],
    action: {
      label: "Abrir a visita na agenda",
      url: requireLink(`/agenda?dia=${dayKey}`, origin),
    },
    secondaryActions: [
      {
        label: "Adicionar ao Google Agenda / Outlook",
        url: requireLink(visitCalendarPath(visitId), origin),
      },
    ],
    closing: [
      "O convite da visita (arquivo .ics) vai em anexo: abra o arquivo no celular ou no computador para adicionar ao Google Agenda, ao Outlook ou ao Calendário da Apple.",
      "Depois da visita, registre o retorno na agenda para não esquecer o próximo passo.",
    ],
    footer: `Você recebeu este e-mail porque é o corretor desta visita em ${brand.name} no CRM. Dá para desligar os lembretes em "Meu perfil".`,
  })
}

// (b2) Visita marcada por outra pessoa --------------------------------------------

export type VisitAssignedEmailParams = VisitReminderEmailParams & {
  /** Quem marcou (ex.: a assistente); sem nome, "Alguém da equipe". */
  assignedByName?: string | null
}

/** Aviso ao corretor quando outra pessoa marca ou remarca uma visita para ele. */
export function visitAssignedEmail(params: VisitAssignedEmailParams): RenderedEmail {
  const origin = requireOrigin(params.origin)
  const brand = resolveBrand(params.brand)
  const visitId = idOrNull(params.visit.id)
  const start = formatSaoPauloTime(params.visit.startsAt)
  const dayKey = toSaoPauloDateKey(params.visit.startsAt)
  const when = visitWhenLabel(params.visit.startsAt, params.now ?? new Date())

  if (!visitId || !start || !dayKey || !when) {
    throw new EmailTemplateError("Visita inválida para o aviso.")
  }

  const line = visitLine(params.visit)
  const end = formatSaoPauloTime(params.visit.endsAt)
  const address = cleanText(params.visit.address, { maxLength: 200 })
  const meeting = cleanText(params.visit.meetingPoint, { maxLength: 200 })
  const client = cleanText(params.visit.clientFirstName, { maxLength: 40 })
  const author = cleanText(params.assignedByName, { maxLength: 80 }) || "Alguém da equipe"

  return renderEmail(params.brand, {
    subject: `Nova visita para você ${when}: ${cleanText(line.property, { maxLength: 60 })}`,
    preheader: `${author} marcou esta visita na sua agenda.`,
    heading: "Visita marcada para você",
    greeting: greetingFor(params.recipientName),
    paragraphs: [
      `${author} marcou uma visita para você ${when}${client ? ` com ${client}` : ""} ao imóvel ${line.property}.`,
    ],
    highlight: meeting ? `Ponto de encontro: ${meeting}` : null,
    details: [
      { label: "Horário", value: end ? `${start} às ${end}` : start },
      { label: "Imóvel", value: line.property },
      { label: "Endereço", value: address },
      { label: "Cliente", value: client },
    ],
    action: {
      label: "Abrir a visita na agenda",
      url: requireLink(`/agenda?dia=${dayKey}`, origin),
    },
    secondaryActions: [
      {
        label: "Adicionar ao Google Agenda / Outlook",
        url: requireLink(visitCalendarPath(visitId), origin),
      },
    ],
    closing: [
      "O convite da visita (arquivo .ics) vai em anexo: abra o arquivo no celular ou no computador para adicionar ao Google Agenda, ao Outlook ou ao Calendário da Apple.",
      "Não pode ir? Avise quem marcou ou troque o corretor na agenda.",
    ],
    footer: `Você recebeu este e-mail porque é o corretor desta visita em ${brand.name} no CRM. Dá para desligar este aviso em "Meu perfil".`,
  })
}

// (c) Relatório semanal -----------------------------------------------------------

export type WeeklyReportTotals = {
  leadsReceived: number
  leadsAnswered: number
  leadsInSla: number
  leadsWon: number
  leadsLost: number
  visitsScheduled: number
  visitsDone: number
  visitsNoShow: number
  proposalsMade: number
  proposalsClosed: number
  /** Em reais (numeric do banco). */
  proposalsClosedAmount: number
  brokersWithActivity: number
}

export type WeeklyReportBroker = {
  name: string
  active?: boolean | null
  leadsReceived: number
  firstResponseMedianMinutes: number | null
  visitsDone: number
  visitsScheduled: number
  proposalsMade: number
  proposalsClosed: number
  leadsWon: number
}

export type WeeklyReportEmailParams = {
  origin: string
  brand?: EmailBrand | null
  recipientName?: string | null
  /** Segunda-feira ("AAAA-MM-DD"). */
  weekStart: string
  /** Domingo ("AAAA-MM-DD"). */
  weekEnd: string
  totals: WeeklyReportTotals
  brokers: readonly WeeklyReportBroker[]
}

/**
 * Corretores listados no corpo do e-mail (tamanho seguro: o Gmail corta
 * mensagens com mais de ~102 KB). Acima disso, a lista completa vai em CSV
 * anexo (weekly-report-csv.ts) e continua na tela de relatórios.
 */
export const WEEKLY_REPORT_MAX_BROKERS = 30

function percent(part: number, total: number) {
  return total > 0 ? `${Math.round((part / total) * 100)}%` : null
}

export function weeklyReportEmail(params: WeeklyReportEmailParams): RenderedEmail {
  const origin = requireOrigin(params.origin)
  const brand = resolveBrand(params.brand)

  if (!isDateKey(params.weekStart) || !isDateKey(params.weekEnd)) {
    throw new EmailTemplateError("Semana inválida para o relatório.")
  }

  const totals = params.totals
  const received = count(totals.leadsReceived)
  const answered = count(totals.leadsAnswered)
  const inSla = count(totals.leadsInSla)
  const won = count(totals.leadsWon)
  const visitsDone = count(totals.visitsDone)
  const visitsScheduled = count(totals.visitsScheduled)
  const proposalsMade = count(totals.proposalsMade)
  const proposalsClosed = count(totals.proposalsClosed)
  const amount =
    typeof totals.proposalsClosedAmount === "number" &&
    Number.isFinite(totals.proposalsClosedAmount)
      ? Math.max(0, totals.proposalsClosedAmount)
      : 0
  const from = formatDateKey(params.weekStart) ?? params.weekStart
  const to = formatDateKey(params.weekEnd) ?? params.weekEnd
  const reportUrl = requireLink(`/relatorios?de=${params.weekStart}&ate=${params.weekEnd}`, origin)
  const brokers = params.brokers.slice(0, WEEKLY_REPORT_MAX_BROKERS)

  const sections: EmailSection[] =
    brokers.length > 0
      ? [
          {
            title: "Por corretor",
            items: brokers.map((broker) => {
              const median = durationLabel(broker.firstResponseMedianMinutes)

              return {
                title: `${cleanText(broker.name, { maxLength: 80 }) || "Membro sem nome"}${broker.active === false ? " (inativo)" : ""}`,
                meta: [
                  plural(count(broker.leadsReceived), "lead", "leads"),
                  median ? `1º contato em ${median} (mediana)` : null,
                  `${plural(count(broker.visitsDone), "visita realizada", "visitas realizadas")} de ${numberFormat.format(count(broker.visitsScheduled))}`,
                  plural(count(broker.proposalsMade), "proposta", "propostas"),
                  plural(count(broker.leadsWon), "ganho", "ganhos"),
                ]
                  .filter(Boolean)
                  .join(" · "),
              }
            }),
            note:
              params.brokers.length > brokers.length
                ? `Mostrando ${numberFormat.format(brokers.length)} de ${numberFormat.format(params.brokers.length)} corretores. A lista completa está no anexo (planilha CSV) e na tela de relatórios.`
                : moreNote(
                    Math.max(count(totals.brokersWithActivity), brokers.length),
                    brokers.length,
                    "na tela de relatórios"
                  ),
          },
        ]
      : []

  return renderEmail(params.brand, {
    subject: `Semana de ${from} a ${to}: ${plural(received, "lead", "leads")}, ${plural(visitsDone, "visita", "visitas")} e ${plural(won, "ganho", "ganhos")}`,
    preheader: `Os números da equipe de ${brand.name} na semana passada, por corretor.`,
    heading: "Relatório da semana",
    greeting: greetingFor(params.recipientName),
    paragraphs: [
      `Estes são os números da equipe de ${from} a ${to} (segunda a domingo). São as mesmas contas da tela de relatórios para o mesmo período.`,
    ],
    details: [
      { label: "Leads recebidos", value: numberFormat.format(received) },
      {
        label: "Atendidos",
        value: `${numberFormat.format(answered)}${percent(answered, received) ? ` (${percent(answered, received)})` : ""}`,
      },
      {
        label: "No prazo de 1º contato",
        value: `${numberFormat.format(inSla)}${percent(inSla, received) ? ` (${percent(inSla, received)})` : ""}`,
      },
      {
        label: "Visitas realizadas",
        value: `${numberFormat.format(visitsDone)} de ${numberFormat.format(visitsScheduled)} agendadas`,
      },
      { label: "Propostas feitas", value: numberFormat.format(proposalsMade) },
      {
        label: "Propostas fechadas",
        value:
          proposalsClosed > 0
            ? `${numberFormat.format(proposalsClosed)} (${formatBRL(Math.round(amount * 100))})`
            : "0",
      },
      { label: "Leads ganhos", value: numberFormat.format(won) },
    ],
    sections,
    action: { label: "Abrir os relatórios da semana", url: reportUrl },
    closing: [
      'Não quer receber este relatório? Desligue em "Meu perfil", na seção de e-mails automáticos.',
    ],
    footer: `Você recebeu este e-mail porque faz a gestão da equipe de ${brand.name} (dono ou gerente) no CRM.`,
  })
}

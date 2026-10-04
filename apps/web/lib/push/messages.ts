import { visitWhenLabel } from "@workspace/core/email/agenda-templates"
import { formatSaoPauloTime, toSaoPauloDateKey } from "@workspace/core/email/reminders"
import { cleanText } from "@workspace/core/email/sanitize"
import { LEAD_SOURCE_EMAIL_LABELS } from "@workspace/core/email/templates"

import { APP_NAME } from "@/components/crm/brand"
import type { LeadAlert } from "@/lib/leads/alerts"

/**
 * Conteúdo dos avisos no celular. A notificação aparece na tela bloqueada,
 * então leva só o nome e a origem do lead: telefone, e-mail e mensagem ficam
 * no CRM. O `url` é sempre um caminho do próprio app (o service worker abre na
 * mesma origem em que o aparelho foi ligado).
 */
export type PushPayload = {
  title: string
  body: string
  url: string
  /** Avisos do mesmo lead se substituem na bandeja do aparelho. */
  tag: string
}

export type PushDeliveryOptions = {
  /** Quanto tempo o serviço de push guarda o aviso com o aparelho desligado. */
  ttlSeconds: number
  urgency: "normal" | "high"
}

/** Aviso de lead que ainda faz sentido chegar depois de algumas horas. */
const LEAD_ALERT_TTL_SECONDS = 6 * 60 * 60

function sourceLabel(source: string | null): string | null {
  if (!source || !Object.hasOwn(LEAD_SOURCE_EMAIL_LABELS, source)) {
    return null
  }

  return LEAD_SOURCE_EMAIL_LABELS[source as keyof typeof LEAD_SOURCE_EMAIL_LABELS]
}

function minutesUntil(dueAt: string | null, now: number): number | null {
  const due = dueAt ? Date.parse(dueAt) : Number.NaN
  return Number.isNaN(due) ? null : Math.ceil((due - now) / 60_000)
}

/**
 * `sla_warning` com o prazo já vencido não vira push: o próximo aviso
 * (redistribuído ou sem atendimento) é o que interessa.
 */
export function shouldPushLeadAlert(
  alert: Pick<LeadAlert, "kind" | "dueAt">,
  now = Date.now()
): boolean {
  if (alert.kind !== "sla_warning") {
    return true
  }

  const left = minutesUntil(alert.dueAt, now)
  return left === null || left > 0
}

export function leadAlertPush(
  alert: Pick<LeadAlert, "kind" | "leadId" | "leadName" | "leadSource" | "slaMinutes" | "dueAt">,
  now = Date.now()
): { payload: PushPayload; options: PushDeliveryOptions } {
  const name = cleanText(alert.leadName, { maxLength: 60 }) || "Novo contato"
  const source = sourceLabel(alert.leadSource)
  const origin = source ? `Origem: ${source}. ` : ""
  const sla = alert.slaMinutes > 0 && alert.slaMinutes <= 24 * 60 ? alert.slaMinutes : null
  const leadUrl = `/leads/${alert.leadId}`
  const tag = `lead-${alert.leadId}`

  switch (alert.kind) {
    case "assigned":
      return {
        payload: {
          title: `Novo lead: ${name}`,
          body: `${origin}${sla ? `Faça o primeiro contato em até ${sla} min.` : "Faça o primeiro contato agora."}`,
          url: leadUrl,
          tag,
        },
        options: { ttlSeconds: LEAD_ALERT_TTL_SECONDS, urgency: "high" },
      }
    case "sla_warning": {
      const left = minutesUntil(alert.dueAt, now)
      const leftText = left === null ? null : left > 1 ? `${left} min` : "menos de 1 min"

      return {
        payload: {
          title: `Prazo acabando: ${name}`,
          body: leftText
            ? `Faltam ${leftText} para o primeiro contato. Depois o lead vai para o próximo corretor.`
            : "O prazo de primeiro contato está acabando. Depois o lead vai para o próximo corretor.",
          url: leadUrl,
          tag,
        },
        // Depois do prazo o aviso não serve mais.
        options: {
          ttlSeconds: left === null ? 15 * 60 : Math.max(60, left * 60),
          urgency: "high",
        },
      }
    }
    case "sla_reassigned":
      return {
        payload: {
          title: `Lead do rodízio é seu: ${name}`,
          body: `${origin}${sla ? `Seu prazo de primeiro contato é de ${sla} min.` : "Faça o primeiro contato agora."}`,
          url: leadUrl,
          tag,
        },
        options: { ttlSeconds: LEAD_ALERT_TTL_SECONDS, urgency: "high" },
      }
    case "sla_lost":
      return {
        payload: {
          title: `Lead repassado: ${name}`,
          body: "O prazo de primeiro contato terminou e o lead foi para outro corretor.",
          url: "/leads",
          tag,
        },
        options: { ttlSeconds: LEAD_ALERT_TTL_SECONDS, urgency: "normal" },
      }
    case "sla_breached":
      return {
        payload: {
          title: `Lead sem atendimento: ${name}`,
          body: `${origin}O prazo de primeiro contato acabou e não havia outro corretor no rodízio.`,
          url: leadUrl,
          tag,
        },
        options: { ttlSeconds: LEAD_ALERT_TTL_SECONDS, urgency: "high" },
      }
  }
}

/**
 * Visita marcada para o corretor por outra pessoa. Na tela bloqueada vai só o
 * horário, o código do imóvel e quem marcou (sem cliente nem endereço).
 */
export function visitAssignedPush(
  notice: {
    visitId: string
    startsAt: string
    propertyCode: string | null
    assignedByName: string | null
  },
  now = new Date()
): { payload: PushPayload; options: PushDeliveryOptions } | null {
  const when = visitWhenLabel(notice.startsAt, now)
  const dayKey = toSaoPauloDateKey(notice.startsAt)

  if (!when || !dayKey) {
    return null
  }

  const code = cleanText(notice.propertyCode, { maxLength: 30 })
  const author = cleanText(notice.assignedByName, { maxLength: 60 }) || "Alguém da equipe"
  const startsIn = Date.parse(notice.startsAt) - now.getTime()

  return {
    payload: {
      title: "Visita marcada para você",
      body: `${when.charAt(0).toUpperCase()}${when.slice(1)}${code ? ` · ${code}` : ""}. Marcada por ${author}.`,
      url: `/agenda?dia=${dayKey}`,
      tag: `visita-${notice.visitId}`,
    },
    // Depois do início da visita o aviso não serve mais.
    options: {
      ttlSeconds: Math.max(60, Math.min(Math.floor(startsIn / 1000), LEAD_ALERT_TTL_SECONDS)),
      urgency: "normal",
    },
  }
}

/** Lembrete de tarefa ~15 min antes do prazo. O título é da própria pessoa. */
export function taskReminderPush(
  reminder: { taskId: string; title: string; dueAt: string },
  now = new Date()
): { payload: PushPayload; options: PushDeliveryOptions } | null {
  const time = formatSaoPauloTime(reminder.dueAt)
  const due = Date.parse(reminder.dueAt)

  if (!time || Number.isNaN(due)) {
    return null
  }

  const minutes = Math.max(1, Math.ceil((due - now.getTime()) / 60_000))
  const title = cleanText(reminder.title, { maxLength: 80 }) || "Tarefa"

  return {
    payload: {
      title: `Tarefa às ${time}: faltam ${minutes} min`,
      body: title,
      url: "/tarefas",
      tag: `tarefa-${reminder.taskId}`,
    },
    // Depois do prazo o lembrete não serve mais.
    options: { ttlSeconds: Math.max(60, minutes * 60), urgency: "high" },
  }
}

export function testPush(): { payload: PushPayload; options: PushDeliveryOptions } {
  return {
    payload: {
      title: `Teste do ${APP_NAME}`,
      body: "Tudo certo: os avisos de lead vão aparecer assim neste aparelho.",
      url: "/perfil",
      tag: "teste",
    },
    options: { ttlSeconds: 5 * 60, urgency: "high" },
  }
}

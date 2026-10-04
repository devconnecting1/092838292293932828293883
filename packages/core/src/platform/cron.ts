/**
 * Console da Plataforma — rotinas agendadas.
 *
 * - Rotinas do banco (pg_cron): estado de cada job a partir da última execução
 *   e das falhas das últimas 24 h, lidas por `platform_health`.
 * - Rotinas da Vercel (apps/web/vercel.json): lista fixa, conferida contra o
 *   arquivo pelo teste. No plano Hobby cada rotina roda no máximo 1x/dia e pode
 *   disparar a qualquer minuto dentro da hora marcada
 *   (https://vercel.com/docs/cron-jobs/usage-and-pricing).
 */

import {
  describeAge,
  formatDurationMinutes,
  minutesSince,
  pluralize,
  type HealthItem,
} from "./health"

const DAY_MINUTES = 24 * 60
const WEEK_MINUTES = 7 * DAY_MINUTES

/** Fuso de Brasília: UTC-3 o ano todo (sem horário de verão desde 2019). */
const BRASILIA_OFFSET_HOURS = -3

const WEEKDAYS = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"]

function isNumber(field: string, max: number): boolean {
  return /^\d{1,2}$/.test(field) && Number(field) <= max
}

function isNumberList(field: string, max: number): boolean {
  return field.split(",").every((part) => isNumber(part, max))
}

function fieldsOf(schedule: string): string[] | null {
  const fields = schedule.trim().split(/\s+/)
  return fields.length === 5 ? fields : null
}

/**
 * Intervalo esperado entre execuções, em minutos, para os formatos usados no
 * projeto; null quando o formato não é reconhecido (a checagem de atraso é
 * pulada).
 */
export function cronIntervalMinutes(schedule: string): number | null {
  const fields = fieldsOf(schedule)

  if (!fields) {
    return null
  }

  const [minute = "", hour = "", dayOfMonth = "", month = "", dayOfWeek = ""] = fields

  if (month !== "*") {
    return null
  }

  if (hour === "*" && dayOfMonth === "*" && dayOfWeek === "*") {
    if (minute === "*") {
      return 1
    }

    const step = /^\*\/(\d{1,2})$/.exec(minute)

    if (step) {
      return Math.max(1, Number(step[1]))
    }

    return isNumberList(minute, 59) ? Math.floor(60 / minute.split(",").length) : null
  }

  if (!isNumberList(minute, 59)) {
    return null
  }

  if (dayOfMonth !== "*") {
    return null
  }

  const hourStep = /^\*\/(\d{1,2})$/.exec(hour)

  if (hourStep && dayOfWeek === "*") {
    return Math.max(1, Number(hourStep[1])) * 60
  }

  if (!isNumberList(hour, 23)) {
    return null
  }

  if (dayOfWeek === "*") {
    return Math.floor(DAY_MINUTES / hour.split(",").length)
  }

  return isNumberList(dayOfWeek, 7) ? Math.floor(WEEK_MINUTES / dayOfWeek.split(",").length) : null
}

function pad(value: number): string {
  return String(value).padStart(2, "0")
}

/**
 * Agenda em pt-BR, com o horário de Brasília para as rotinas diárias e
 * semanais: "a cada minuto", "a cada 5 min", "todo dia às 05:07 (Brasília)",
 * "toda segunda às 07:00 (Brasília)". Formato desconhecido volta como está.
 */
export function describeCronSchedule(schedule: string): string {
  const fields = fieldsOf(schedule)
  const interval = cronIntervalMinutes(schedule)

  if (!fields || interval === null) {
    return `agenda ${schedule.trim()} (UTC)`
  }

  const [minute = "", hour = "", , , dayOfWeek = ""] = fields

  if (hour === "*") {
    return interval === 1 ? "a cada minuto" : `a cada ${formatDurationMinutes(interval)}`
  }

  if (!isNumber(minute, 59) || !isNumber(hour, 23)) {
    return `a cada ${formatDurationMinutes(interval)}`
  }

  const utcHour = Number(hour)
  const localHour = (((utcHour + BRASILIA_OFFSET_HOURS) % 24) + 24) % 24
  const dayShift = utcHour + BRASILIA_OFFSET_HOURS < 0 ? -1 : 0
  const time = `${pad(localHour)}:${pad(Number(minute))} (Brasília)`

  if (dayOfWeek === "*") {
    return `todo dia às ${time}`
  }

  if (isNumber(dayOfWeek, 7)) {
    const day = WEEKDAYS[(((Number(dayOfWeek) + dayShift) % 7) + 7) % 7]
    const prefix = day === "sábado" || day === "domingo" ? "todo" : "toda"
    return `${prefix} ${day} às ${time}`
  }

  return `a cada ${formatDurationMinutes(interval)}`
}

// -----------------------------------------------------------------------------
// Rotinas do banco (pg_cron)
// -----------------------------------------------------------------------------

/** Linha de `platform_health().cron_jobs`. */
export type DatabaseCronJob = {
  name: string
  schedule: string
  active: boolean
  /** starting, running, sending, connecting, succeeded ou failed (pg_cron). */
  lastStatus: string | null
  lastStartedAt: string | null
  lastFinishedAt: string | null
  /** Primeira linha da mensagem de erro, já sem e-mail nem números longos. */
  lastMessage: string | null
  runs24h: number
  failures24h: number
}

/** O que cada job do pg_cron faz, em pt-BR (supabase/README.md). */
export const DATABASE_CRON_JOB_LABELS: Record<string, string> = {
  "limpeza-nonces-e-tentativas": "Limpeza das proteções dos formulários públicos",
  "limpeza-convites-expirados": "Limpeza de convites expirados",
  "retencao-auditoria": "Retenção do histórico de auditoria",
  "limpeza-historico-cron": "Limpeza do histórico das rotinas",
  "limpeza-ia": "Limpeza das reservas de IA",
  "rodizio-de-leads": "Rodízio de leads e prazo de primeiro contato",
  "expurgo-caixa": "Expurgo de imóveis antigos da Caixa",
  "lembretes-de-visita": "Fila de lembretes de visita",
  "retencao-registro-console": "Retenção do registro do console",
  "status-publico-medicoes": "Medições da página de status pública",
}

const RUNNING_STATUSES = new Set(["starting", "running", "sending", "connecting"])

/** Histórico do pg_cron guardado pelo job limpeza-historico-cron. */
const HISTORY_DAYS = 14

function jobItem(job: DatabaseCronJob, rest: Omit<HealthItem, "key" | "label" | "reference">) {
  return {
    key: `cron_${job.name}`,
    label: DATABASE_CRON_JOB_LABELS[job.name] ?? job.name,
    reference: job.name,
    ...rest,
  } satisfies HealthItem
}

function schedulePhrase(job: DatabaseCronJob): string {
  return describeCronSchedule(job.schedule)
}

/** Estado de um job do pg_cron. */
export function evaluateDatabaseCronJob(job: DatabaseCronJob, now: Date): HealthItem {
  const interval = cronIntervalMinutes(job.schedule)
  const schedule = schedulePhrase(job)

  if (!job.active) {
    return jobItem(job, {
      status: "atencao",
      detail: `Rotina desligada (agenda: ${schedule}).`,
      action: `Se não foi de propósito, religue no SQL Editor: select cron.alter_job(job_id := (select jobid from cron.job where jobname = '${job.name}'), active := true);`,
    })
  }

  if (job.lastStatus === "failed") {
    const message = job.lastMessage?.trim() ? ` Mensagem: ${job.lastMessage.trim()}` : ""
    return jobItem(job, {
      status: "problema",
      detail:
        `A última execução falhou ${describeAge(job.lastStartedAt, now)} ` +
        `(${pluralize(job.failures24h, "falha", "falhas")} nas últimas 24 h).${message}`,
      action: `Veja o erro completo em cron.job_run_details (jobname ${job.name}) e corrija a função chamada pela rotina.`,
    })
  }

  if (!job.lastStartedAt) {
    if (interval !== null && interval <= DAY_MINUTES) {
      return jobItem(job, {
        status: "atencao",
        detail: `Nenhuma execução nos últimos ${HISTORY_DAYS} dias (agenda: ${schedule}).`,
        action:
          "Confira se a extensão pg_cron está ativa e se o projeto do Supabase não foi pausado.",
      })
    }

    return jobItem(job, {
      status: "ok",
      detail: `Ainda sem execução no histórico (agenda: ${schedule}).`,
      action: null,
    })
  }

  const age = minutesSince(job.lastStartedAt, now)

  if (job.lastStatus && RUNNING_STATUSES.has(job.lastStatus) && age !== null && age > 60) {
    return jobItem(job, {
      status: "atencao",
      detail: `Em execução há ${formatDurationMinutes(age)}.`,
      action:
        "Veja em pg_stat_activity se a rotina está travada; ela volta a rodar no próximo horário.",
    })
  }

  if (interval !== null && age !== null && age > Math.max(interval * 3, interval + 15)) {
    return jobItem(job, {
      status: "problema",
      detail: `Não roda há ${formatDurationMinutes(age)} (agenda: ${schedule}).`,
      action:
        "Confira se a extensão pg_cron está ativa e se o projeto do Supabase não foi pausado.",
    })
  }

  if (job.failures24h > 0) {
    return jobItem(job, {
      status: "atencao",
      detail:
        `A última execução deu certo (${describeAge(job.lastStartedAt, now)}), mas houve ` +
        `${pluralize(job.failures24h, "falha", "falhas")} nas últimas 24 h.`,
      action: `Veja as falhas em cron.job_run_details (jobname ${job.name}).`,
    })
  }

  return jobItem(job, {
    status: "ok",
    detail:
      `Última execução ${describeAge(job.lastStartedAt, now)} · ` +
      `${pluralize(job.runs24h, "execução", "execuções")} em 24 h (agenda: ${schedule}).`,
    action: null,
  })
}

// -----------------------------------------------------------------------------
// Rotinas da Vercel (apps/web/vercel.json)
// -----------------------------------------------------------------------------

export type VercelCron = {
  path: string
  schedule: string
  label: string
}

/**
 * Espelho de `crons` em apps/web/vercel.json (o teste compara os dois). Ao
 * mudar o arquivo, atualize aqui.
 */
export const VERCEL_CRONS: readonly VercelCron[] = [
  {
    path: "/api/cron/billing-reminders",
    schedule: "0 11 * * *",
    label: "Avisos de assinatura (teste acabando, pagamento pendente)",
  },
  {
    path: "/api/cron/lead-alerts",
    schedule: "30 11 * * *",
    label: "Fila de avisos de lead (rede de segurança do webhook)",
  },
  {
    path: "/api/cron/caixa-catalog",
    schedule: "7 8 * * *",
    label: "Lembrete de envio da lista da Caixa",
  },
  {
    path: "/api/cron/lead-ingest",
    schedule: "13 9 * * *",
    label: "Reprocessamento de leads do Meta Lead Ads (última rede; o pg_cron tenta a cada 5 min)",
  },
  {
    path: "/api/cron/authorization-alerts",
    schedule: "40 10 * * *",
    label: "Avisos de autorização de venda vencendo",
  },
  {
    path: "/api/cron/daily-digest",
    schedule: "0 10 * * *",
    label: "Resumo diário por e-mail",
  },
  {
    path: "/api/cron/weekly-report",
    schedule: "0 10 * * 1,2",
    label: "Relatório semanal por e-mail (segunda, repescagem na terça)",
  },
  {
    path: "/api/cron/organization-deletion",
    schedule: "50 7 * * *",
    label: "Exclusão de imobiliária (aviso de 3 dias e limpeza dos arquivos)",
  },
]

/** Estado das rotinas da Vercel: dependem de CRON_SECRET e do limite do Hobby. */
export function evaluateVercelCrons(options: { hasCronSecret: boolean }): HealthItem[] {
  return VERCEL_CRONS.map((cron) => {
    const interval = cronIntervalMinutes(cron.schedule)
    const schedule = describeCronSchedule(cron.schedule)
    const base = { key: `vercel_${cron.path}`, label: cron.label, reference: cron.path }

    if (interval !== null && interval < DAY_MINUTES) {
      return {
        ...base,
        status: "problema",
        detail: `Agenda ${schedule}: mais de 1x por dia, o deploy falha no plano Hobby.`,
        action: "Mude a agenda em apps/web/vercel.json para 1x por dia ou passe o time para o Pro.",
      } satisfies HealthItem
    }

    if (!options.hasCronSecret) {
      return {
        ...base,
        status: "problema",
        detail: `Agenda ${schedule}, mas sem CRON_SECRET a rota recusa a chamada da Vercel.`,
        action: "Defina CRON_SECRET nas variáveis do projeto na Vercel e refaça o deploy.",
      } satisfies HealthItem
    }

    return {
      ...base,
      status: "ok",
      detail: `Agenda ${schedule}; no Hobby pode disparar em qualquer minuto dessa hora.`,
      action: null,
    } satisfies HealthItem
  })
}

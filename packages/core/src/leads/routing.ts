/**
 * Rodízio (roleta) de leads, escala de plantão e SLA de primeiro contato.
 *
 * Módulo puro: sem banco, sem rede e sem `Date.now()` — quem chama informa o
 * instante. As mesmas regras estão implementadas em SQL na migração
 * `lead_roulette_sla` (funções `private.lead_routing_*`); este arquivo é a
 * referência legível e testável delas. Ao mudar uma regra aqui, mude também no
 * banco (o sorteio de verdade acontece lá, dentro de uma transação).
 *
 * Ordem do rodízio (a mesma do `order by` da RPC):
 *   1. menor "quota do dia" = leads recebidos hoje ÷ peso;
 *   2. desempate: quem está há mais tempo sem receber (nunca recebeu vem antes);
 *   3. desempate final: id do usuário, só para o resultado ser determinístico.
 */

// -----------------------------------------------------------------------------
// Limites e padrões (iguais aos CHECKs da migração)
// -----------------------------------------------------------------------------

/** Meta de primeiro contato padrão: responder em 5 min converte muito mais. */
export const LEAD_SLA_DEFAULT_MINUTES = 5
export const LEAD_SLA_MIN_MINUTES = 1
/** 24 h: acima disso o prazo deixa de ser um SLA de primeiro contato. */
export const LEAD_SLA_MAX_MINUTES = 1440

/** Percentual do prazo já decorrido que dispara o aviso "vai estourar". */
export const LEAD_SLA_DEFAULT_WARNING_PERCENT = 70
export const LEAD_SLA_MIN_WARNING_PERCENT = 10
export const LEAD_SLA_MAX_WARNING_PERCENT = 95

/** Quantas vezes o mesmo lead pode ser redistribuído antes de parar de girar. */
export const LEAD_SLA_DEFAULT_MAX_REASSIGNMENTS = 3
export const LEAD_SLA_MAX_REASSIGNMENTS = 10

export const LEAD_ROUTING_MIN_WEIGHT = 1
export const LEAD_ROUTING_MAX_WEIGHT = 10
export const LEAD_ROUTING_MAX_DAILY_LIMIT = 500

/** Fuso usado para o dia do limite diário e para as janelas de plantão. */
export const LEAD_ROUTING_TIME_ZONE = "America/Sao_Paulo"

/** Sem nenhuma janela futura conhecida, o lead é reavaliado daqui a tanto. */
export const LEAD_ROUTING_RETRY_MINUTES = 15

const MINUTES_PER_DAY = 1440
const DAYS_PER_WEEK = 7
const MS_PER_MINUTE = 60_000

// -----------------------------------------------------------------------------
// Escala (plantão)
// -----------------------------------------------------------------------------

/** Uma janela de atendimento de um corretor, no fuso da imobiliária. */
export type LeadShift = {
  /** 0 = domingo … 6 = sábado (igual a `extract(dow)` no Postgres). */
  weekday: number
  /** Início, em minutos desde 00:00. */
  startMinute: number
  /** Fim (exclusivo), em minutos desde 00:00; 1440 = meia-noite seguinte. */
  endMinute: number
}

/** Dia da semana e hora já convertidos para o fuso da imobiliária. */
export type LeadRoutingClock = {
  /** 0 = domingo … 6 = sábado. */
  weekday: number
  /** Minutos desde 00:00. */
  minuteOfDay: number
}

const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
}

const formatters = new Map<string, Intl.DateTimeFormat | null>()

function formatterFor(timeZone: string) {
  if (formatters.has(timeZone)) {
    return formatters.get(timeZone) ?? null
  }

  let formatter: Intl.DateTimeFormat | null = null

  try {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
  } catch {
    formatter = null
  }

  formatters.set(timeZone, formatter)
  return formatter
}

/** Epoch em ms de `Date`, número ou texto ISO; `null` quando não dá para ler. */
export function toEpochMs(value: Date | string | number | null | undefined): number | null {
  if (value === null || value === undefined) return null

  const ms =
    value instanceof Date ? value.getTime() : typeof value === "number" ? value : Date.parse(value)

  return Number.isFinite(ms) ? ms : null
}

/** Dia da semana e minuto do dia no fuso informado. `null` se o fuso for inválido. */
export function zonedClock(
  at: Date | string | number,
  timeZone: string = LEAD_ROUTING_TIME_ZONE
): LeadRoutingClock | null {
  const ms = toEpochMs(at)
  const formatter = formatterFor(timeZone)

  if (ms === null || !formatter) {
    return null
  }

  let weekday: number | undefined
  let hour: number | undefined
  let minute: number | undefined

  for (const part of formatter.formatToParts(new Date(ms))) {
    if (part.type === "weekday") weekday = WEEKDAY_INDEX[part.value]
    else if (part.type === "hour") hour = Number(part.value)
    else if (part.type === "minute") minute = Number(part.value)
  }

  if (weekday === undefined || !Number.isFinite(hour) || !Number.isFinite(minute)) {
    return null
  }

  // Alguns ambientes devolvem "24" para meia-noite em hourCycle h23.
  const minuteOfDay = ((hour as number) % 24) * 60 + (minute as number)
  return { weekday, minuteOfDay }
}

/** Janela válida e normalizada, ou `null` (o banco recusa as mesmas). */
export function normalizeShift(shift: {
  weekday: number
  startMinute: number
  endMinute: number
}): LeadShift | null {
  const weekday = Math.trunc(shift.weekday)
  const startMinute = Math.trunc(shift.startMinute)
  const endMinute = Math.trunc(shift.endMinute)

  if (!Number.isFinite(weekday) || weekday < 0 || weekday > 6) return null
  if (!Number.isFinite(startMinute) || startMinute < 0 || startMinute >= MINUTES_PER_DAY)
    return null
  if (!Number.isFinite(endMinute) || endMinute <= startMinute || endMinute > MINUTES_PER_DAY) {
    return null
  }

  return { weekday, startMinute, endMinute }
}

/**
 * Sem nenhuma janela cadastrada o corretor atende sempre (é o padrão de quem
 * não usa escala). Com janelas, só dentro delas.
 */
export function isWithinShift(shifts: readonly LeadShift[], clock: LeadRoutingClock): boolean {
  if (shifts.length === 0) {
    return true
  }

  return shifts.some(
    (shift) =>
      shift.weekday === clock.weekday &&
      clock.minuteOfDay >= shift.startMinute &&
      clock.minuteOfDay < shift.endMinute
  )
}

/**
 * Minutos até a próxima janela: 0 quando já está dentro de uma (ou quando não
 * há escala), e `null` quando não existe nenhuma janela nos próximos 7 dias.
 */
export function minutesUntilNextShift(
  shifts: readonly LeadShift[],
  clock: LeadRoutingClock
): number | null {
  if (shifts.length === 0 || isWithinShift(shifts, clock)) {
    return 0
  }

  let best: number | null = null

  for (let day = 0; day <= DAYS_PER_WEEK; day += 1) {
    const weekday = (clock.weekday + day) % DAYS_PER_WEEK

    for (const shift of shifts) {
      if (shift.weekday !== weekday) continue

      const waited = day * MINUTES_PER_DAY + shift.startMinute - clock.minuteOfDay

      if (waited > 0 && (best === null || waited < best)) {
        best = waited
      }
    }
  }

  return best
}

/** Menor espera entre todos os corretores da fila (a "próxima janela" do lead). */
export function minutesUntilNextQueueWindow(
  candidates: readonly LeadRoutingCandidate[],
  clock: LeadRoutingClock
): number | null {
  let best: number | null = null

  for (const candidate of candidates) {
    const waited = minutesUntilNextShift(candidate.shifts, clock)

    if (waited !== null && (best === null || waited < best)) {
      best = waited
    }
  }

  return best
}

// -----------------------------------------------------------------------------
// Fila do rodízio
// -----------------------------------------------------------------------------

/** Um corretor da fila, já com o que o sorteio precisa saber. */
export type LeadRoutingCandidate = {
  userId: string
  /** Peso: quem tem 2 recebe o dobro de quem tem 1. */
  weight: number
  /** Teto de leads por dia; `null` = sem limite. */
  dailyLimit: number | null
  /** Leads recebidos hoje (fuso da imobiliária). */
  assignedToday: number
  /** Quando recebeu o último lead; `null` = nunca recebeu. */
  lastAssignedAtMs: number | null
  /** Férias/ausência (intervalo aberto nas pontas nulas). */
  awayFromMs?: number | null
  awayUntilMs?: number | null
  shifts: readonly LeadShift[]
}

export type LeadRoutingContext = {
  atMs: number
  clock: LeadRoutingClock
  /** Respeitar a escala de plantão (configuração da imobiliária). */
  respectSchedule: boolean
  /** Quem não pode receber agora (ex.: quem acabou de estourar o prazo). */
  exclude?: readonly string[]
}

function clampInteger(value: unknown, min: number, max: number, fallback: number) {
  // `Number(null)` e `Number("")` valem 0: sem valor informado usamos o padrão.
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim() !== ""
        ? Number(value)
        : Number.NaN

  if (!Number.isFinite(parsed)) return fallback

  return Math.min(max, Math.max(min, Math.trunc(parsed)))
}

export function clampWeight(value: unknown) {
  return clampInteger(value, LEAD_ROUTING_MIN_WEIGHT, LEAD_ROUTING_MAX_WEIGHT, 1)
}

/** Está de férias/ausente no instante informado. */
export function isCandidateAway(candidate: LeadRoutingCandidate, atMs: number) {
  const from = candidate.awayFromMs ?? null
  const until = candidate.awayUntilMs ?? null

  if (from === null && until === null) return false
  if (from !== null && atMs < from) return false
  if (until !== null && atMs >= until) return false

  return true
}

/** Pode receber agora: não excluído, não ausente, dentro da escala e do limite. */
export function isCandidateAvailable(candidate: LeadRoutingCandidate, ctx: LeadRoutingContext) {
  if (ctx.exclude?.includes(candidate.userId)) return false
  if (isCandidateAway(candidate, ctx.atMs)) return false

  if (ctx.respectSchedule && !isWithinShift(candidate.shifts, ctx.clock)) {
    return false
  }

  const limit = candidate.dailyLimit

  if (limit !== null && limit !== undefined && candidate.assignedToday >= limit) {
    return false
  }

  return true
}

/** Quota do dia: leads recebidos hoje ÷ peso (menor recebe primeiro). */
export function dailyShare(candidate: LeadRoutingCandidate) {
  return Math.max(0, candidate.assignedToday) / clampWeight(candidate.weight)
}

/** Ordem do rodízio: quota do dia, depois quem está há mais tempo sem receber. */
export function compareRoutingCandidates(a: LeadRoutingCandidate, b: LeadRoutingCandidate) {
  const shareA = dailyShare(a)
  const shareB = dailyShare(b)

  if (shareA !== shareB) {
    return shareA - shareB
  }

  const lastA = a.lastAssignedAtMs
  const lastB = b.lastAssignedAtMs

  if (lastA !== lastB) {
    // Nunca recebeu entra na frente de quem já recebeu.
    if (lastA === null) return -1
    if (lastB === null) return 1
    return lastA - lastB
  }

  return a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0
}

/** Próximo corretor da fila, ou `null` quando ninguém pode receber agora. */
export function pickNextAssignee(
  candidates: readonly LeadRoutingCandidate[],
  ctx: LeadRoutingContext
): string | null {
  const available = candidates.filter((candidate) => isCandidateAvailable(candidate, ctx))

  if (available.length === 0) {
    return null
  }

  return available.reduce((best, candidate) =>
    compareRoutingCandidates(candidate, best) < 0 ? candidate : best
  ).userId
}

export type LeadRoutingDecision =
  | { kind: "assigned"; userId: string }
  /** Ninguém disponível agora: o lead espera a próxima janela de plantão. */
  | { kind: "queued"; retryInMinutes: number }
  /** Fila vazia (ou todo mundo fora): não há para quem mandar. */
  | { kind: "unavailable" }

/**
 * Decisão completa do rodízio: a quem entregar agora ou quando tentar de novo.
 * Espelha `private.lead_routing_pick` + o `routing_due_at` gravado no lead.
 */
export function routeLead(
  candidates: readonly LeadRoutingCandidate[],
  ctx: LeadRoutingContext
): LeadRoutingDecision {
  const userId = pickNextAssignee(candidates, ctx)

  if (userId) {
    return { kind: "assigned", userId }
  }

  const eligible = candidates.filter(
    (candidate) => !ctx.exclude?.includes(candidate.userId) && !isCandidateAway(candidate, ctx.atMs)
  )

  if (eligible.length === 0) {
    return { kind: "unavailable" }
  }

  const waited = ctx.respectSchedule ? minutesUntilNextQueueWindow(eligible, ctx.clock) : 0

  return {
    kind: "queued",
    retryInMinutes: waited === null || waited <= 0 ? LEAD_ROUTING_RETRY_MINUTES : waited,
  }
}

// -----------------------------------------------------------------------------
// SLA de primeiro contato
// -----------------------------------------------------------------------------

export function clampSlaMinutes(value: unknown) {
  return clampInteger(value, LEAD_SLA_MIN_MINUTES, LEAD_SLA_MAX_MINUTES, LEAD_SLA_DEFAULT_MINUTES)
}

export function clampWarningPercent(value: unknown) {
  return clampInteger(
    value,
    LEAD_SLA_MIN_WARNING_PERCENT,
    LEAD_SLA_MAX_WARNING_PERCENT,
    LEAD_SLA_DEFAULT_WARNING_PERCENT
  )
}

export function clampMaxReassignments(value: unknown) {
  return clampInteger(value, 0, LEAD_SLA_MAX_REASSIGNMENTS, LEAD_SLA_DEFAULT_MAX_REASSIGNMENTS)
}

/** Prazo do primeiro contato a partir de quando o corretor recebeu o lead. */
export function slaDeadlineMs(assignedAtMs: number, slaMinutes: number) {
  return assignedAtMs + clampSlaMinutes(slaMinutes) * MS_PER_MINUTE
}

/** Instante do aviso "o prazo vai estourar" (percentual do prazo já decorrido). */
export function slaWarningMs(assignedAtMs: number, dueAtMs: number, warningPercent: number) {
  const total = dueAtMs - assignedAtMs

  if (!Number.isFinite(total) || total <= 0) {
    return dueAtMs
  }

  return assignedAtMs + Math.floor((total * clampWarningPercent(warningPercent)) / 100)
}

export type LeadSlaState = "idle" | "ok" | "warning" | "breached"

/**
 * Estado do prazo:
 *   idle     — sem prazo (lead sem responsável, já contatado ou fora de "Novo");
 *   ok       — dentro do prazo;
 *   warning  — passou do percentual de aviso;
 *   breached — estourou (é o que dispara a redistribuição).
 */
export function leadSlaState(input: {
  assignedAtMs: number | null
  dueAtMs: number | null
  nowMs: number
  warningPercent?: number
}): LeadSlaState {
  const { assignedAtMs, dueAtMs, nowMs } = input

  if (dueAtMs === null || !Number.isFinite(dueAtMs)) {
    return "idle"
  }

  if (nowMs >= dueAtMs) {
    return "breached"
  }

  if (assignedAtMs === null || !Number.isFinite(assignedAtMs)) {
    return "ok"
  }

  const warningAt = slaWarningMs(
    assignedAtMs,
    dueAtMs,
    input.warningPercent ?? LEAD_SLA_DEFAULT_WARNING_PERCENT
  )

  return nowMs >= warningAt ? "warning" : "ok"
}

/** Minutos que faltam para o prazo (0 quando já estourou), arredondados para cima. */
export function slaMinutesLeft(dueAtMs: number | null, nowMs: number) {
  if (dueAtMs === null || !Number.isFinite(dueAtMs)) {
    return 0
  }

  return Math.max(0, Math.ceil((dueAtMs - nowMs) / MS_PER_MINUTE))
}

// -----------------------------------------------------------------------------
// Primeiro contato e prazo estourado (migração leads_first_contact_and_alerts)
// -----------------------------------------------------------------------------

/**
 * Primeiro contato do lead, como o trigger `leads_before_write` grava: nasce no
 * primeiro `last_contact_at` preenchido (contato "no futuro" vira o instante da
 * gravação) e nunca mais muda — um novo "Registrar contato" só mexe no último.
 */
export function resolveFirstContactAtMs(input: {
  previousFirstContactMs: number | null
  lastContactMs: number | null
  nowMs: number
}): number | null {
  const { previousFirstContactMs, lastContactMs, nowMs } = input

  if (previousFirstContactMs !== null && Number.isFinite(previousFirstContactMs)) {
    return previousFirstContactMs
  }

  if (lastContactMs === null || !Number.isFinite(lastContactMs)) {
    return null
  }

  return Math.min(lastContactMs, nowMs)
}

export type LeadOverdueDecision =
  /** Há outro corretor que pode receber agora: o lead volta para a roleta. */
  | { kind: "reassign"; userId: string }
  /**
   * Ninguém mais pode receber agora (ou as redistribuições acabaram): o lead
   * continua com o responsável, o estouro é registrado e a gestão é avisada.
   */
  | { kind: "keep" }

/**
 * O que a passada agendada faz com um lead que estourou o prazo do primeiro
 * contato. Espelha o passo (c) de `private.run_lead_routing_pass`: o lead nunca
 * fica sem responsável por estouro de prazo.
 */
export function decideOverdueLead(input: {
  candidates: readonly LeadRoutingCandidate[]
  ctx: LeadRoutingContext
  assignedTo: string
  reassignments: number
  maxReassignments: number
}): LeadOverdueDecision {
  if (input.reassignments >= clampMaxReassignments(input.maxReassignments)) {
    return { kind: "keep" }
  }

  const exclude = [...(input.ctx.exclude ?? []), input.assignedTo]
  const userId = pickNextAssignee(input.candidates, { ...input.ctx, exclude })

  return userId ? { kind: "reassign", userId } : { kind: "keep" }
}

/**
 * Página de status — incidentes automáticos, sem IA: regras fixas e
 * conservadoras que o banco aplica a cada minuto
 * (`private.status_auto_incidents_step`, migração
 * status_page_automatic_incidents). Aqui ficam o espelho puro dessas regras
 * (para testar e explicar no Console), os textos de modelo e os rótulos dos
 * fornecedores e do aviso por e-mail. Mudou aqui, mude lá (e vice-versa).
 */

import type { MeasuredStatusLevel } from "./levels"
import { STATUS_COMPONENTS, type IncidentImpact, type StatusComponentKey } from "./public"

/** Números das regras (iguais às constantes do banco). */
export const AUTO_INCIDENT_RULES = {
  /** Instabilidade parcial ou fora do ar por N medições seguidas abre incidente. */
  openOutageSamples: 3,
  /** Lentidão (ou pior) por N medições seguidas abre incidente de impacto pequeno. */
  openDegradedSamples: 10,
  /** N medições seguidas operacionais passam para "monitorando". */
  recoverySamples: 5,
  /** Minutos estáveis em "monitorando" para resolver sozinho. */
  monitoringMinutes: 15,
  /** Caiu de novo até N minutos depois de resolvido: reabre o mesmo. */
  reopenWindowMinutes: 30,
  /** Incidentes automáticos por parte por dia (dia de São Paulo). */
  maxPerComponentPerDay: 6,
  /** Atualizações por incidente antes de a automação pausar. */
  maxUpdatesPerIncident: 30,
  /** Lentidão por N medições depois de uma queda: impacto volta a pequeno. */
  calmSamplesToLowerImpact: 10,
  /** Intervalo sem medição (minutos) que recomeça a contagem. */
  streakGapMinutes: 5,
  /** Medição mais velha que isso não conta para recuperar ou piorar. */
  recentMeasurementMinutes: 10,
} as const

/** Textos de modelo publicados pela automação (sem detalhe interno). */
export const AUTO_INCIDENT_MESSAGES = {
  openedOne:
    "Detectamos automaticamente uma instabilidade nesta parte do sistema. Estamos verificando.",
  openedMany:
    "Detectamos automaticamente uma instabilidade nestas partes do sistema. Estamos verificando.",
  worsened: "A instabilidade piorou. Estamos verificando.",
  relapsed: "A instabilidade voltou. Estamos verificando.",
  lowered: "A instabilidade diminuiu, mas ainda há lentidão. Seguimos verificando.",
  monitoring: "O funcionamento voltou ao normal. Seguimos acompanhando.",
  resolved: "Resolvido. O funcionamento está normal.",
  /** Acrescentado quando algum fornecedor tem incidente em andamento (sem o nome). */
  vendorSuffix: " Há possível relação com instabilidade em um fornecedor de infraestrutura.",
} as const

/** Título do incidente automático ("Instabilidade em <parte>" ou genérico). */
export function automaticIncidentTitle(keys: readonly StatusComponentKey[]): string {
  if (keys.length === 1) {
    const name = STATUS_COMPONENTS.find((component) => component.key === keys[0])?.name
    return `Instabilidade em ${name ?? keys[0]}`
  }

  return "Instabilidade em várias partes do sistema"
}

/** Medições seguidas de uma parte (nível automático depois da histerese). */
export type AutoStreaks = {
  level: MeasuredStatusLevel | null
  /** Instabilidade parcial ou fora do ar. */
  downStreak: number
  /** Qualquer coisa pior que operacional. */
  impairedStreak: number
  okStreak: number
  /** Operacional ou lentidão. */
  calmStreak: number
  /** ISO da última medição contada; null nunca mediu. */
  lastSampleAt: string | null
}

export const EMPTY_AUTO_STREAKS: AutoStreaks = {
  level: null,
  downStreak: 0,
  impairedStreak: 0,
  okStreak: 0,
  calmStreak: 0,
  lastSampleAt: null,
}

/**
 * Soma uma medição (nível já confirmado pela histerese) nas contagens.
 * Medição sem nível confirmado (null) não conta nada — "sem medição" nunca é
 * queda. Intervalo maior que 5 min recomeça as contagens. Espelho de
 * `private.status_auto_update_trackers`.
 */
export function advanceAutoStreaks(
  previous: AutoStreaks,
  level: MeasuredStatusLevel | null,
  measuredAt: Date
): AutoStreaks {
  if (level === null) {
    return previous
  }

  const last = previous.lastSampleAt ? Date.parse(previous.lastSampleAt) : Number.NaN

  if (Number.isFinite(last) && last >= measuredAt.getTime()) {
    return previous
  }

  const continues =
    Number.isFinite(last) &&
    last >= measuredAt.getTime() - AUTO_INCIDENT_RULES.streakGapMinutes * 60_000
  const next = (current: number, hit: boolean) => (hit ? (continues ? current + 1 : 1) : 0)
  const down = level === "partial_outage" || level === "major_outage"

  return {
    level,
    downStreak: next(previous.downStreak, down),
    impairedStreak: next(previous.impairedStreak, level !== "operational"),
    okStreak: next(previous.okStreak, level === "operational"),
    calmStreak: next(previous.calmStreak, !down),
    lastSampleAt: measuredAt.toISOString(),
  }
}

/**
 * Impacto que a medição justifica agora (null = nenhum): instabilidade parcial
 * ou fora do ar há 3 medições seguidas → grande ou crítico; lentidão ou pior
 * há 10 → pequeno. Espelho de `private.status_auto_qualifying_impact`.
 */
export function qualifyingAutoImpact(
  streaks: Pick<AutoStreaks, "level" | "downStreak" | "impairedStreak">
): IncidentImpact | null {
  const { level, downStreak, impairedStreak } = streaks

  if (downStreak >= AUTO_INCIDENT_RULES.openOutageSamples) {
    if (level === "major_outage") return "critical"
    if (level === "partial_outage") return "major"
  }

  if (
    level !== null &&
    level !== "operational" &&
    impairedStreak >= AUTO_INCIDENT_RULES.openDegradedSamples
  ) {
    return "minor"
  }

  return null
}

export const INCIDENT_IMPACT_RANK: Record<IncidentImpact, number> = {
  none: 0,
  minor: 1,
  major: 2,
  critical: 3,
}

/** Origem do incidente. */
export type IncidentSource = "automatic" | "team"

export const INCIDENT_SOURCE_LABELS: Record<IncidentSource, string> = {
  automatic: "Detectado automaticamente",
  team: "Publicado pela equipe",
}

export function isIncidentSource(value: unknown): value is IncidentSource {
  return value === "automatic" || value === "team"
}

/** Por que a automação parou de mexer num incidente automático. */
export type AutomationStopReason = "equipe" | "limite_de_atualizacoes"

export type AutomationState = "ativa" | "assumido" | "pausada" | "nao_se_aplica"

/** Estado da automação num incidente (para o selo do Console). */
export function automationStateOf(incident: {
  source: IncidentSource
  automationStoppedReason: AutomationStopReason | null
}): AutomationState {
  if (incident.source !== "automatic") {
    return "nao_se_aplica"
  }

  if (incident.automationStoppedReason === "equipe") {
    return "assumido"
  }

  return incident.automationStoppedReason === "limite_de_atualizacoes" ? "pausada" : "ativa"
}

export const AUTOMATION_STATE_LABELS: Record<Exclude<AutomationState, "nao_se_aplica">, string> = {
  ativa: "Automação conduzindo",
  assumido: "Assumido pela equipe",
  pausada: "Automação pausada",
}

/** Explicação curta das regras, para o Console. */
export const AUTO_INCIDENT_RULES_SUMMARY: readonly string[] = [
  `Abre quando uma parte fica em instabilidade parcial ou fora do ar por ${AUTO_INCIDENT_RULES.openOutageSamples} medições seguidas (impacto grande ou crítico) ou lenta por ${AUTO_INCIDENT_RULES.openDegradedSamples} (impacto pequeno). Partes que caem no mesmo minuto entram no mesmo incidente.`,
  "Não abre se a parte já está num incidente em aberto, em manutenção em andamento ou sem medição (sem medição nunca é queda).",
  `Piorou: publica atualização com o impacto novo. ${AUTO_INCIDENT_RULES.recoverySamples} medições seguidas normais: “Monitorando”. Mais ${AUTO_INCIDENT_RULES.monitoringMinutes} min estável: “Resolvido”. Caiu de novo até ${AUTO_INCIDENT_RULES.reopenWindowMinutes} min depois: reabre o mesmo.`,
  `No máximo ${AUTO_INCIDENT_RULES.maxPerComponentPerDay} incidentes automáticos por parte por dia (depois disso, reabre o último) e ${AUTO_INCIDENT_RULES.maxUpdatesPerIncident} atualizações por incidente (depois disso, a automação pausa e pede a equipe).`,
  "Publicar atualização, editar ou clicar em “Assumir” tira o incidente da automação.",
]

// ---------------------------------------------------------------------------
// Fornecedores (só sinal interno)
// ---------------------------------------------------------------------------

/** status.indicator do Atlassian Statuspage. */
export type VendorIndicator = "none" | "minor" | "major" | "critical"

export const VENDOR_INDICATOR_LABELS: Record<VendorIndicator, string> = {
  none: "operacional",
  minor: "com incidente pequeno",
  major: "com incidente grande",
  critical: "com incidente crítico",
}

/** Leitura mais velha que isso não vale (o banco lê a cada 5 min). */
export const VENDOR_READING_STALE_MINUTES = 15

export type VendorSignal = {
  name: string
  indicator: VendorIndicator | null
  checkedAt: string | null
}

export type VendorSignalState = "operacional" | "incidente" | "sem_leitura"

export function vendorSignalState(vendor: VendorSignal, now: Date): VendorSignalState {
  const checked = vendor.checkedAt ? Date.parse(vendor.checkedAt) : Number.NaN

  if (
    vendor.indicator === null ||
    !Number.isFinite(checked) ||
    now.getTime() - checked > VENDOR_READING_STALE_MINUTES * 60_000
  ) {
    return "sem_leitura"
  }

  return vendor.indicator === "none" ? "operacional" : "incidente"
}

/** "Supabase operacional", "Vercel com incidente grande", "Supabase sem leitura recente". */
export function describeVendorSignal(vendor: VendorSignal, now: Date): string {
  const state = vendorSignalState(vendor, now)

  if (state === "sem_leitura" || vendor.indicator === null) {
    return `${vendor.name} sem leitura recente`
  }

  return `${vendor.name} ${VENDOR_INDICATOR_LABELS[vendor.indicator]}`
}

/** "Fornecedores: Supabase operacional · Vercel com incidente pequeno". */
export function summarizeVendorSignals(vendors: readonly VendorSignal[], now: Date): string {
  if (vendors.length === 0) {
    return "Fornecedores: nenhum acompanhado"
  }

  return `Fornecedores: ${vendors.map((vendor) => describeVendorSignal(vendor, now)).join(" · ")}`
}

/** Fornecedores usados que ficaram de fora do acompanhamento, e por quê. */
export const VENDORS_NOT_MONITORED: readonly { name: string; reason: string }[] = [
  {
    name: "Stripe",
    reason: "A página de status da Stripe não oferece um JSON de status documentado oficialmente.",
  },
  {
    name: "Brevo",
    reason:
      "A página de status da Brevo não publica uma API de status documentada oficialmente para leitura automática.",
  },
]

export const VENDOR_READING_RESULT_LABELS: Record<string, string> = {
  ok: "Leitura normal",
  sem_resposta: "O fornecedor não respondeu a tempo",
  http_erro: "O fornecedor respondeu com erro",
  tempo_esgotado: "Tempo esgotado (5 s)",
  erro_conexao: "Não foi possível conectar",
  resposta_invalida: "Resposta fora do formato esperado",
  falha_ao_enviar: "O banco não conseguiu disparar a consulta",
}

// ---------------------------------------------------------------------------
// Aviso aos Donos por e-mail
// ---------------------------------------------------------------------------

/** Trava: e-mails de aviso em 24 h, somando todos os destinatários (igual ao banco). */
export const STATUS_ALERT_DAILY_EMAIL_LIMIT = 10

/** Teto de destinatários por aviso (a lista de Donos é curta; o resto ficaria sem cota). */
export const STATUS_ALERT_MAX_RECIPIENTS = 5

export type StatusAlertKind = "opened" | "resolved"

export function isStatusAlertKind(value: unknown): value is StatusAlertKind {
  return value === "opened" || value === "resolved"
}

/** Primeiros destinatários da lista de Donos, no teto. */
export function selectStatusAlertRecipients(emails: Iterable<string>): string[] {
  return [...emails].slice(0, STATUS_ALERT_MAX_RECIPIENTS)
}

/** SQL de exemplo para ligar o aviso por e-mail (só marcadores; nunca um segredo real). */
export const STATUS_ALERTS_SETUP_SQL: readonly string[] = [
  "select vault.create_secret('https://<seu-dominio>/api/cron/status-alerts', 'status_alerts_webhook_url');",
  "select vault.create_secret('<mesmo valor de CRON_SECRET>', 'status_alerts_webhook_secret');",
]

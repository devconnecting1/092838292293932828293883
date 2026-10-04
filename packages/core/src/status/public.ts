/**
 * Página de status pública (/status): contrato de dados entre o banco, o
 * servidor e as telas.
 *
 * O que vai para o público é só isto: nome e situação de cada parte do
 * sistema, disponibilidade por dia e os incidentes e manutenções escritos pela
 * equipe. Nunca vai detalhe interno da Saúde do sistema (variáveis, segredos,
 * filas, contagens, nomes de rotinas, mensagens de erro).
 *
 * Níveis e estados seguem a convenção usada por páginas de status conhecidas
 * (componente operacional/degradado/parcial/total/manutenção; incidente
 * investigando/identificado/monitorando/resolvido), com rótulos em pt-BR.
 */

/** Situação de uma parte do sistema, da melhor para a pior (manutenção à parte). */
export const STATUS_LEVELS = [
  "operational",
  "degraded_performance",
  "partial_outage",
  "major_outage",
  "under_maintenance",
] as const

export type StatusLevel = (typeof STATUS_LEVELS)[number]

export const STATUS_LEVEL_LABELS: Record<StatusLevel, string> = {
  operational: "Operacional",
  degraded_performance: "Lentidão",
  partial_outage: "Instabilidade parcial",
  major_outage: "Fora do ar",
  under_maintenance: "Em manutenção",
}

/** Partes do sistema mostradas ao público, na ordem da página. */
export const STATUS_COMPONENT_KEYS = [
  "crm",
  "login",
  "leads_capture",
  "lead_routing",
  "notifications",
  "integrations",
  "caixa_catalog",
  "billing",
] as const

export type StatusComponentKey = (typeof STATUS_COMPONENT_KEYS)[number]

export type StatusComponentInfo = {
  key: StatusComponentKey
  /** Nome curto, como o cliente reconhece. */
  name: string
  /** Uma frase do que essa parte faz. */
  description: string
}

export const STATUS_COMPONENTS: readonly StatusComponentInfo[] = [
  {
    key: "crm",
    name: "CRM",
    description: "Telas do sistema: painel, leads, imóveis, clientes, agenda e propostas.",
  },
  {
    key: "login",
    name: "Login e contas",
    description: "Entrar, criar conta, recuperar senha e convites.",
  },
  {
    key: "leads_capture",
    name: "Landing pages e captação",
    description: "Páginas públicas, formulários de contato e páginas dos imóveis.",
  },
  {
    key: "lead_routing",
    name: "Rodízio de leads",
    description: "Distribuição automática dos leads e prazo de primeiro contato.",
  },
  {
    key: "notifications",
    name: "Avisos por e-mail e no celular",
    description: "Aviso de novo lead, lembretes de visita, resumo diário e relatório semanal.",
  },
  {
    key: "integrations",
    name: "Portais e integrações",
    description: "Leads que chegam dos portais e contas conectadas.",
  },
  {
    key: "caixa_catalog",
    name: "Imóveis da Caixa",
    description: "Catálogo de imóveis da Caixa Econômica Federal.",
  },
  {
    key: "billing",
    name: "Assinaturas e pagamentos",
    description: "Planos, cobrança e faturas.",
  },
]

export type IncidentImpact = "none" | "minor" | "major" | "critical"

export const INCIDENT_IMPACT_LABELS: Record<IncidentImpact, string> = {
  none: "Sem impacto",
  minor: "Impacto pequeno",
  major: "Impacto grande",
  critical: "Impacto crítico",
}

export type IncidentStatus = "investigating" | "identified" | "monitoring" | "resolved"

export type MaintenanceStatus = "scheduled" | "in_progress" | "completed"

export const INCIDENT_STATUS_LABELS: Record<IncidentStatus | MaintenanceStatus, string> = {
  investigating: "Investigando",
  identified: "Causa identificada",
  monitoring: "Monitorando",
  resolved: "Resolvido",
  scheduled: "Agendada",
  in_progress: "Em andamento",
  completed: "Concluída",
}

/** Um dia da barra de disponibilidade (dia do calendário de São Paulo). */
export type StatusDay = {
  /** AAAA-MM-DD. */
  date: string
  /** 0 a 100, com até 2 casas; null quando não houve medição no dia. */
  uptimePct: number | null
  /** Pior situação registrada no dia (medição automática ou incidente). */
  worstLevel: StatusLevel
  /** Incidentes que tocaram esta parte no dia (ids de PublicIncident). */
  incidentIds: string[]
}

export type PublicStatusComponent = StatusComponentInfo & {
  level: StatusLevel
  /**
   * A parte tem sinal automático ligado (mesmo que ainda sem medição)? false =
   * só a equipe acompanha (incidente/manutenção). Opcional para aceitar
   * retratos antigos; ausente = não informado.
   */
  automaticSignal?: boolean
  /** Disponibilidade dos últimos 90 dias; null sem medição. */
  uptime90dPct: number | null
  /** 90 dias, do mais antigo para o mais recente. */
  days: StatusDay[]
}

export type PublicIncidentUpdate = {
  status: IncidentStatus | MaintenanceStatus
  /** Texto escrito pela equipe (sem HTML). */
  message: string
  createdAt: string
}

export type PublicIncident = {
  id: string
  kind: "incident" | "maintenance"
  title: string
  impact: IncidentImpact
  status: IncidentStatus | MaintenanceStatus
  componentKeys: StatusComponentKey[]
  startedAt: string
  resolvedAt: string | null
  /** Manutenção: início e fim previstos. */
  scheduledFor: string | null
  scheduledUntil: string | null
  /**
   * Quem abriu: a automação da página de status (regras fixas, sem IA) ou a
   * equipe. Opcional para aceitar retratos antigos; ausente = equipe. Nunca diz
   * quem da equipe.
   */
  source?: "automatic" | "team"
  /** Da mais recente para a mais antiga. */
  updates: PublicIncidentUpdate[]
}

export type PublicStatusSnapshot = {
  generatedAt: string
  /** Última medição automática registrada; null se nunca houve. */
  lastCheckedAt: string | null
  /** Pior situação entre as partes (manutenção só quando nada está pior). */
  overall: StatusLevel
  components: PublicStatusComponent[]
  activeIncidents: PublicIncident[]
  upcomingMaintenances: PublicIncident[]
  /** Resolvidos/concluídos dos últimos 14 dias, do mais recente para o mais antigo. */
  pastIncidents: PublicIncident[]
}

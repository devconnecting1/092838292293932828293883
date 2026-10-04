import "server-only"

import {
  buildLeadsFunnelChart,
  buildLeadsWeeklyChart,
  buildPropertiesStatusChart,
  LEADS_CHART_WEEKS,
  LEADS_FUNNEL_DAYS,
  type LeadsFunnelChart,
  type LeadsWeeklyChart,
  type PropertiesStatusChart,
} from "@/lib/painel/charts"
import { createClient } from "@/lib/supabase/server"

/**
 * Dados dos gráficos do Painel.
 *
 * Cada consulta chama uma RPC que já devolve os números somados pelo Postgres
 * (nunca a lista de leads ou de imóveis) e roda com a sessão do usuário, então
 * o RLS decide o que entra na conta. `null` = não foi possível carregar; a tela
 * mostra um estado vazio em vez de quebrar o painel inteiro.
 */

function logFailure(scope: string, error: unknown) {
  console.error(
    `[painel] falha ao carregar ${scope}:`,
    error instanceof Error ? error.message : "erro desconhecido"
  )
}

export async function loadLeadsWeeklyChart(
  organizationId: string
): Promise<LeadsWeeklyChart | null> {
  try {
    const supabase = await createClient()
    const { data, error } = await supabase.rpc("dashboard_leads_by_week", {
      p_organization_id: organizationId,
      p_weeks: LEADS_CHART_WEEKS,
    })

    if (error) {
      logFailure("os leads por semana", error)
      return null
    }

    return buildLeadsWeeklyChart(data ?? [], { weeks: LEADS_CHART_WEEKS })
  } catch (error) {
    logFailure("os leads por semana", error)
    return null
  }
}

export async function loadLeadsFunnelChart(
  organizationId: string
): Promise<LeadsFunnelChart | null> {
  try {
    const supabase = await createClient()
    const { data, error } = await supabase.rpc("dashboard_leads_by_stage", {
      p_organization_id: organizationId,
      p_days: LEADS_FUNNEL_DAYS,
    })

    if (error) {
      logFailure("o funil de leads", error)
      return null
    }

    return buildLeadsFunnelChart(data ?? [], { days: LEADS_FUNNEL_DAYS })
  } catch (error) {
    logFailure("o funil de leads", error)
    return null
  }
}

export async function loadPropertiesStatusChart(
  organizationId: string
): Promise<PropertiesStatusChart | null> {
  try {
    const supabase = await createClient()
    const { data, error } = await supabase.rpc("dashboard_properties_by_status", {
      p_organization_id: organizationId,
    })

    if (error) {
      logFailure("os imóveis por status", error)
      return null
    }

    return buildPropertiesStatusChart(data ?? [])
  } catch (error) {
    logFailure("os imóveis por status", error)
    return null
  }
}

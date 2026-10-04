import "server-only"

import {
  clampMaxReassignments,
  clampSlaMinutes,
  clampWarningPercent,
  LEAD_SLA_DEFAULT_MAX_REASSIGNMENTS,
  LEAD_SLA_DEFAULT_MINUTES,
  LEAD_SLA_DEFAULT_WARNING_PERCENT,
} from "@workspace/core/leads/routing"

import type { LeadsServerClient } from "@/lib/leads/db"
import type { LeadSlaSettings } from "@/lib/leads/types"

/**
 * Configuração de rodízio e SLA da imobiliária (`public.lead_routing_settings`,
 * migração `lead_roulette_sla`). A linha é opcional: quem nunca abriu as
 * configurações roda com os padrões (rodízio desligado, 5 min, aviso em 70%).
 *
 * Só leitura: quem grava é a tela de configurações. Falha de rede ou de RLS
 * também cai nos padrões — o quadro de leads não pode deixar de abrir por causa
 * do selo de prazo.
 */
export const DEFAULT_LEAD_SLA_SETTINGS: LeadSlaSettings = {
  slaMinutes: LEAD_SLA_DEFAULT_MINUTES,
  warningPercent: LEAD_SLA_DEFAULT_WARNING_PERCENT,
  rouletteEnabled: false,
  slaReassignEnabled: false,
  maxReassignments: LEAD_SLA_DEFAULT_MAX_REASSIGNMENTS,
}

export async function getLeadSlaSettings(
  supabase: LeadsServerClient,
  organizationId: string
): Promise<LeadSlaSettings> {
  const { data, error } = await supabase
    .from("lead_routing_settings")
    .select(
      "roulette_enabled, sla_minutes, sla_warning_percent, sla_reassign_enabled, max_reassignments"
    )
    .eq("organization_id", organizationId)
    .maybeSingle()

  if (error) {
    console.error("[leads] falha ao ler as configurações de SLA:", error.code ?? "erro")
    return DEFAULT_LEAD_SLA_SETTINGS
  }

  if (!data) {
    return DEFAULT_LEAD_SLA_SETTINGS
  }

  // Clamp mesmo vindo do banco: os CHECKs podem mudar antes desta tela.
  return {
    slaMinutes: clampSlaMinutes(data.sla_minutes),
    warningPercent: clampWarningPercent(data.sla_warning_percent),
    rouletteEnabled: data.roulette_enabled,
    slaReassignEnabled: data.sla_reassign_enabled,
    maxReassignments: clampMaxReassignments(data.max_reassignments),
  }
}

export type { LeadSlaSettings }

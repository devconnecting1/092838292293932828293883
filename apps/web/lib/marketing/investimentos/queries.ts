import "server-only"

import {
  dateToMonthKey,
  monthKeyToDate,
  reaisToCents,
  shiftMonthKey,
} from "@workspace/core/reports/marketing-investments"

import { isLeadSource } from "@/lib/leads/constants"
import type { LeadSource } from "@/lib/leads/db-types"
import { createClient } from "@/lib/supabase/server"

export type MarketingInvestment = {
  id: string
  month: string
  source: LeadSource
  campaign: string | null
  amountCents: number
  notes: string | null
  updatedAt: string
}

export type CampaignSuggestion = {
  source: LeadSource
  campaign: string
  leads: number
}

/** Lançamentos de um mês ("AAAA-MM"), do maior valor para o menor. */
export async function listMonthInvestments(
  organizationId: string,
  monthKey: string
): Promise<MarketingInvestment[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from("marketing_investments")
    .select("id, month, source, utm_campaign, amount, notes, updated_at")
    .eq("organization_id", organizationId)
    .eq("month", monthKeyToDate(monthKey))
    .order("amount", { ascending: false })
    .limit(500)

  if (error) {
    throw new Error(`Não foi possível carregar os investimentos (${error.code ?? "erro"}).`)
  }

  return (data ?? []).flatMap((row) =>
    isLeadSource(row.source)
      ? [
          {
            id: row.id,
            month: dateToMonthKey(row.month) ?? monthKey,
            source: row.source,
            campaign: row.utm_campaign,
            amountCents: reaisToCents(row.amount),
            notes: row.notes,
            updatedAt: row.updated_at,
          },
        ]
      : []
  )
}

/** Totais dos meses anteriores (para comparar), em centavos por mês "AAAA-MM". */
export async function getRecentMonthTotals(
  organizationId: string,
  monthKey: string,
  months: number
): Promise<{ month: string; totalCents: number }[]> {
  const first = shiftMonthKey(monthKey, -(months - 1)) ?? monthKey
  const supabase = await createClient()
  const { data, error } = await supabase
    .from("marketing_investments")
    .select("month, amount")
    .eq("organization_id", organizationId)
    .gte("month", monthKeyToDate(first))
    .lte("month", monthKeyToDate(monthKey))
    .limit(5000)

  if (error) {
    throw new Error(`Não foi possível carregar os totais por mês (${error.code ?? "erro"}).`)
  }

  const totals = new Map<string, number>()

  for (let delta = -(months - 1); delta <= 0; delta += 1) {
    const key = shiftMonthKey(monthKey, delta)
    if (key) totals.set(key, 0)
  }

  for (const row of data ?? []) {
    const key = dateToMonthKey(row.month)

    if (key && totals.has(key)) {
      totals.set(key, (totals.get(key) ?? 0) + reaisToCents(row.amount))
    }
  }

  return [...totals.entries()].map(([month, totalCents]) => ({ month, totalCents }))
}

/**
 * Campanhas (utm_campaign) que trouxeram leads nos últimos 180 dias, para o
 * lançamento casar com a atribuição. A RPC só responde para dono e gerente.
 */
export async function listCampaignSuggestions(
  organizationId: string
): Promise<CampaignSuggestion[]> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc("list_lead_campaigns", {
    p_organization_id: organizationId,
  })

  if (error) {
    // Sugestão é ajuda, não bloqueia o lançamento.
    return []
  }

  return (data ?? []).flatMap((row) =>
    isLeadSource(row.source) && row.utm_campaign
      ? [{ source: row.source, campaign: row.utm_campaign, leads: Number(row.leads) || 0 }]
      : []
  )
}

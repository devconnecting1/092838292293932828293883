import "server-only"

import { z } from "zod"

import type { ServerSupabaseClient } from "@/lib/imoveis/queries"

/**
 * Cartão "Autorizações vencendo" do Painel. A RPC dashboard_authorization_alerts
 * (security invoker) soma no Postgres e devolve só os imóveis que vencem
 * primeiro; o RLS decide o que entra na conta. `null` = não carregou.
 */

export const AUTHORIZATION_DASHBOARD_LIMIT = 5

const itemSchema = z.object({
  property_id: z.guid(),
  code: z.string(),
  title: z.string(),
  neighborhood: z.string().nullable(),
  city: z.string().nullable(),
  ends_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  days_left: z.number().int(),
  exclusive: z.boolean(),
})

const dashboardSchema = z.object({
  expiring_total: z.number().int().nonnegative(),
  expired_total: z.number().int().nonnegative(),
  items: z.array(itemSchema),
})

export type AuthorizationDashboardItem = {
  propertyId: string
  code: string
  title: string
  place: string | null
  endsOn: string
  daysLeft: number
  exclusive: boolean
}

export type AuthorizationDashboard = {
  expiringTotal: number
  expiredTotal: number
  items: AuthorizationDashboardItem[]
}

export async function getAuthorizationDashboard(
  supabase: ServerSupabaseClient,
  organizationId: string
): Promise<AuthorizationDashboard | null> {
  try {
    const { data, error } = await supabase.rpc("dashboard_authorization_alerts", {
      p_organization_id: organizationId,
      p_limit: AUTHORIZATION_DASHBOARD_LIMIT,
    })

    if (error) {
      console.error(
        `[painel] falha ao carregar as autorizações vencendo (código ${error.code ?? "erro"})`
      )
      return null
    }

    const parsed = dashboardSchema.safeParse(data)

    if (!parsed.success) {
      console.error("[painel] autorizações vencendo: resposta inesperada")
      return null
    }

    return {
      expiringTotal: parsed.data.expiring_total,
      expiredTotal: parsed.data.expired_total,
      items: parsed.data.items.map((item) => ({
        propertyId: item.property_id,
        code: item.code,
        title: item.title,
        place: [item.neighborhood, item.city].filter(Boolean).join(", ") || null,
        endsOn: item.ends_on,
        daysLeft: item.days_left,
        exclusive: item.exclusive,
      })),
    }
  } catch (error) {
    console.error(
      `[painel] falha ao carregar as autorizações vencendo (${error instanceof Error ? error.name : "erro"})`
    )
    return null
  }
}

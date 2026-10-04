import "server-only"

import { sendNotificationEmail } from "@/lib/email"
import type { EmailAddress } from "@/lib/email/types"
import { createClient } from "@/lib/supabase/server"

/**
 * Avisos de franquia de IA (80% e 100%). Quem garante "no máximo um de cada por
 * ciclo" é o banco: `reserve_ai_usage`/`settle_ai_usage` reservam o aviso dentro
 * da mesma transação do consumo e devolvem `notify`. Aqui só se busca quem
 * avisar e dispara o e-mail. Nunca lança (roda em `after()`).
 */

export type AiQuotaNoticePayload = {
  organizationId: string
  level: "80" | "100"
  periodStart: string
  periodEnd: string | null
  conversationsUsed: number
  conversationsLimit: number
  costCents: number
  capCents: number
  overageCapCents: number
}

/** Responsáveis pela assinatura: donos e gerentes ativos com e-mail. */
async function loadRecipients(organizationId: string): Promise<{
  slug: string
  name: string
  to: EmailAddress[]
} | null> {
  const supabase = await createClient()

  const [organizationResult, membershipsResult] = await Promise.all([
    supabase.from("organizations").select("slug, name").eq("id", organizationId).maybeSingle(),
    supabase
      .from("memberships")
      .select("user_id, role")
      .eq("organization_id", organizationId)
      .eq("active", true)
      .in("role", ["owner", "manager"]),
  ])

  const organization = organizationResult.data

  if (!organization?.slug) {
    return null
  }

  const userIds = (membershipsResult.data ?? []).map((membership) => membership.user_id)

  if (userIds.length === 0) {
    return null
  }

  const { data: profiles } = await supabase
    .from("profiles")
    .select("id, full_name, email")
    .in("id", userIds)

  const seen = new Set<string>()
  const to: EmailAddress[] = []

  for (const profile of profiles ?? []) {
    const email = profile.email?.trim().toLowerCase()

    if (!email || seen.has(email)) {
      continue
    }

    seen.add(email)
    to.push({ email, name: profile.full_name ?? undefined })
  }

  return to.length > 0
    ? { slug: organization.slug, name: organization.name ?? "sua imobiliária", to }
    : null
}

export async function sendAiQuotaNotice(payload: AiQuotaNoticePayload): Promise<void> {
  try {
    const target = await loadRecipients(payload.organizationId)

    if (!target) {
      console.warn("[ia] aviso de franquia sem destinatário (dono ou gerente com e-mail)")
      return
    }

    await sendNotificationEmail("ai_quota_notice", {
      organizationSlug: target.slug,
      organizationName: target.name,
      notice: payload.level === "100" ? "ai_quota_100" : "ai_quota_80",
      periodStart: payload.periodStart,
      periodEnd: payload.periodEnd,
      conversationsUsed: payload.conversationsUsed,
      conversationsLimit: payload.conversationsLimit,
      costCents: payload.costCents,
      capCents: payload.capCents,
      overageCapCents: payload.overageCapCents,
      to: target.to,
    })
  } catch (error) {
    console.error(`[ia] aviso de franquia falhou (${error instanceof Error ? error.name : "erro"})`)
  }
}

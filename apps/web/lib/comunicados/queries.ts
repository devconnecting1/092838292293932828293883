import "server-only"

import {
  isAnnouncementForRole,
  isAnnouncementKind,
  normalizeAnnouncementLink,
  sanitizeAnnouncementText,
} from "@workspace/core/platform/announcements"

import type { ActiveAnnouncement } from "@/lib/comunicados/types"
import { createClient } from "@/lib/supabase/server"

/** No máximo tantas faixas ao mesmo tempo (as mais recentes primeiro). */
export const MAX_VISIBLE_ANNOUNCEMENTS = 3

/**
 * Comunicados da plataforma no ar para a sessão, ainda não dispensados por ela.
 *
 * A RLS de public.platform_announcements já entrega só o que está no período e
 * do público certo (dono/gerente em alguma imobiliária); aqui filtra de novo
 * pelo papel na imobiliária ABERTA e limpa texto e link mais uma vez (defesa em
 * profundidade: o banco já recusa HTML e link sem https). Lança em erro de
 * banco — quem chama decide não mostrar nada.
 */
export async function listActiveAnnouncements(role: string): Promise<ActiveAnnouncement[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from("platform_announcements")
    .select("id, title, body, kind, audience, link_url, link_label, starts_at")
    .order("starts_at", { ascending: false })
    .limit(20)

  if (error) {
    throw new Error(`comunicados indisponíveis (${error.code || "sem código"})`)
  }

  const candidates = (data ?? []).filter((row) => isAnnouncementForRole(row.audience, role))

  if (candidates.length === 0) {
    return []
  }

  const { data: dismissals, error: dismissalsError } = await supabase
    .from("platform_announcement_dismissals")
    .select("announcement_id")
    .in(
      "announcement_id",
      candidates.map((row) => row.id)
    )

  if (dismissalsError) {
    throw new Error(`dispensas indisponíveis (${dismissalsError.code || "sem código"})`)
  }

  const dismissed = new Set((dismissals ?? []).map((row) => row.announcement_id))
  const announcements: ActiveAnnouncement[] = []

  for (const row of candidates) {
    if (dismissed.has(row.id)) {
      continue
    }

    const title = sanitizeAnnouncementText(row.title)
    const body = sanitizeAnnouncementText(row.body)
    const link = normalizeAnnouncementLink(row.link_url)
    const linkUrl = link.ok ? link.url : null

    if (!title || !body) {
      continue
    }

    announcements.push({
      id: row.id,
      title,
      body,
      kind: isAnnouncementKind(row.kind) ? row.kind : "informacao",
      linkUrl,
      linkLabel: linkUrl ? sanitizeAnnouncementText(row.link_label) || null : null,
    })

    if (announcements.length >= MAX_VISIBLE_ANNOUNCEMENTS) {
      break
    }
  }

  return announcements
}

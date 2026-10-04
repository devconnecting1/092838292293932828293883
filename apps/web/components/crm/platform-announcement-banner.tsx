import { Suspense } from "react"

import { PlatformAnnouncementList } from "@/lib/comunicados/announcement-list"
import { listActiveAnnouncements } from "@/lib/comunicados/queries"

/**
 * Comunicados da equipe da plataforma no topo do CRM (faixa discreta, que o
 * usuário dispensa). Tem o próprio Suspense: não segura o resto da casca. Se a
 * consulta falhar, não mostra nada — um aviso nunca derruba a página.
 */
export function PlatformAnnouncementBanner({ role }: { role: string }) {
  return (
    <Suspense fallback={null}>
      <PlatformAnnouncements role={role} />
    </Suspense>
  )
}

async function loadAnnouncements(role: string) {
  try {
    return await listActiveAnnouncements(role)
  } catch (cause) {
    console.error(
      `[crm] comunicados da plataforma indisponíveis (${cause instanceof Error ? cause.name : "erro"})`
    )
    return []
  }
}

async function PlatformAnnouncements({ role }: { role: string }) {
  const announcements = await loadAnnouncements(role)

  return announcements.length > 0 ? (
    <PlatformAnnouncementList announcements={announcements} />
  ) : null
}

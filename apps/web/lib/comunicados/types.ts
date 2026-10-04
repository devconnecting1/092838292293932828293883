import type { AnnouncementKind } from "@workspace/core/platform/announcements"

/** Comunicado pronto para a faixa do CRM (texto limpo, link só https). */
export type ActiveAnnouncement = {
  id: string
  title: string
  body: string
  kind: AnnouncementKind
  linkUrl: string | null
  linkLabel: string | null
}

import type { Metadata } from "next"
import { MegaphoneIcon } from "lucide-react"

import { announcementStatus } from "@workspace/core/platform/announcements"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@workspace/ui/components/empty"

import { PageHeading } from "@/components/crm/page-placeholder"
import { AnnouncementFormDialog } from "@/components/plataforma/comunicados/announcement-form-dialog"
import { AnnouncementsSection } from "@/components/plataforma/comunicados/announcements-list"
import { PlatformReadOnlyNotice } from "@/components/plataforma/equipe/read-only-notice"
import { PlatformRpcFailureAlert } from "@/components/plataforma/platform-rpc-failure-alert"
import { canAct, requirePlatformAdmin } from "@/lib/plataforma/admin"
import { listPlatformAnnouncements } from "@/lib/plataforma/comunicados"

export const metadata: Metadata = {
  title: "Comunicados",
}

/**
 * Comunicados globais para o CRM das imobiliárias: criar, editar e encerrar.
 * Cada mudança grava o registro do console na mesma transação (RPC). A faixa no
 * CRM é components/crm/platform-announcement-banner.tsx. "Somente leitura" vê
 * tudo com os botões desabilitados (as actions e a RPC recusam de novo).
 */
export default async function PlatformAnnouncementsPage() {
  const admin = await requirePlatformAdmin()
  const readOnly = !canAct(admin)

  const result = await listPlatformAnnouncements()
  const now = new Date()
  const announcements = result.ok ? result.data : []
  const current = announcements
    .filter((announcement) => {
      const status = announcementStatus(announcement, now)
      return status === "no_ar" || status === "agendado"
    })
    .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt))
  const past = announcements.filter((announcement) => !current.includes(announcement))

  return (
    <div className="flex flex-1 flex-col gap-6 p-4 lg:p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <PageHeading
          title="Comunicados"
          description="Avisos da plataforma numa faixa discreta no topo do CRM. Cada pessoa pode dispensar o seu; o registro do console guarda quem criou, editou ou encerrou."
        />
        {result.ok && announcements.length > 0 ? (
          <AnnouncementFormDialog announcementId={null} readOnly={readOnly} />
        ) : null}
      </div>

      {readOnly ? <PlatformReadOnlyNotice /> : null}

      {!result.ok ? <PlatformRpcFailureAlert failure={result} /> : null}

      {result.ok && announcements.length === 0 ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <MegaphoneIcon />
            </EmptyMedia>
            <EmptyTitle>Nenhum comunicado ainda</EmptyTitle>
            <EmptyDescription>
              Use para avisar manutenção, mudança de cobrança ou novidade. Escolha quem vê e por
              quanto tempo fica no ar.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <AnnouncementFormDialog announcementId={null} readOnly={readOnly} />
          </EmptyContent>
        </Empty>
      ) : null}

      {current.length > 0 ? (
        <AnnouncementsSection
          title="No ar e agendados"
          description="O que as imobiliárias estão vendo agora ou vão ver. Editar não mostra de novo para quem já dispensou."
          announcements={current}
          now={now}
          readOnly={readOnly}
        />
      ) : null}

      {past.length > 0 ? (
        <AnnouncementsSection
          title="Encerrados e terminados"
          description="Histórico dos últimos comunicados (somente leitura)."
          announcements={past}
          now={now}
          readOnly={readOnly}
        />
      ) : null}
    </div>
  )
}

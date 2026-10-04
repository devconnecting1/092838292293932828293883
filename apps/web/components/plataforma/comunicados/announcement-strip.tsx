import type * as React from "react"
import { ExternalLinkIcon, InfoIcon, TriangleAlertIcon, WrenchIcon } from "lucide-react"

import {
  ANNOUNCEMENT_DEFAULT_LINK_LABEL,
  ANNOUNCEMENT_KIND_LABELS,
  type AnnouncementKind,
} from "@workspace/core/platform/announcements"
import { Alert, AlertAction, AlertDescription, AlertTitle } from "@workspace/ui/components/alert"

const KIND_ICONS: Record<AnnouncementKind, typeof InfoIcon> = {
  informacao: InfoIcon,
  atencao: TriangleAlertIcon,
  manutencao: WrenchIcon,
}

/**
 * Gravidade da faixa a partir do tipo gravado em `platform_announcements.kind`
 * (é o que o Console mostra como selo). Recado comum fica no fundo neutro; o
 * banco não tem um tipo acima de "atenção", então nenhum comunicado chega a
 * vermelho — incidente é outra faixa (status-incident-banner).
 */
const KIND_VARIANTS: Record<AnnouncementKind, React.ComponentProps<typeof Alert>["variant"]> = {
  informacao: "default",
  atencao: "warning",
  manutencao: "maintenance",
}

export type AnnouncementStripContent = {
  title: string
  body: string
  kind: AnnouncementKind
  linkUrl: string | null
  linkLabel: string | null
}

/**
 * Faixa discreta de um comunicado da plataforma. Só apresentação (sem estado):
 * a mesma no topo do CRM e na prévia do formulário do console. Texto puro — o
 * React escapa tudo — e link só https, que abre em outra aba sem passar o
 * endereço de origem.
 */
export function AnnouncementStrip({
  announcement,
  action,
}: {
  announcement: AnnouncementStripContent
  /** Botão de dispensar (CRM); ausente na prévia. */
  action?: React.ReactNode
}) {
  const Icon = KIND_ICONS[announcement.kind]

  return (
    <Alert
      variant={KIND_VARIANTS[announcement.kind]}
      role="status"
      aria-label={`Comunicado: ${announcement.title}`}
    >
      <Icon aria-label={ANNOUNCEMENT_KIND_LABELS[announcement.kind]} />
      <AlertTitle className="break-words">{announcement.title}</AlertTitle>
      <AlertDescription className="flex flex-col gap-1 break-words">
        <span>{announcement.body}</span>
        {announcement.linkUrl ? (
          <a
            href={announcement.linkUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex w-fit items-center gap-1 font-medium"
          >
            {announcement.linkLabel || ANNOUNCEMENT_DEFAULT_LINK_LABEL}
            <ExternalLinkIcon aria-hidden="true" className="size-3.5" />
            <span className="sr-only">(abre em outra aba)</span>
          </a>
        ) : null}
      </AlertDescription>
      {action ? <AlertAction>{action}</AlertAction> : null}
    </Alert>
  )
}

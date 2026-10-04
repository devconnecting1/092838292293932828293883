import { ExternalLinkIcon } from "lucide-react"

import {
  ANNOUNCEMENT_AUDIENCE_LABELS,
  ANNOUNCEMENT_DEFAULT_LINK_LABEL,
  ANNOUNCEMENT_KIND_LABELS,
  ANNOUNCEMENT_STATUS_LABELS,
  announcementStatus,
  isAnnouncementAudience,
  isAnnouncementKind,
  toBrasiliaInputValue,
  type AnnouncementFormValues,
  type AnnouncementStatus,
} from "@workspace/core/platform/announcements"
import { Badge } from "@workspace/ui/components/badge"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"

import { AnnouncementFormDialog } from "@/components/plataforma/comunicados/announcement-form-dialog"
import { EndAnnouncementButton } from "@/components/plataforma/comunicados/end-announcement-button"
import { formatDateTime, formatNumber } from "@/lib/format"
import type { PlatformAnnouncement } from "@/lib/plataforma/comunicados"

const STATUS_VARIANTS: Record<AnnouncementStatus, "default" | "secondary" | "outline"> = {
  no_ar: "default",
  agendado: "secondary",
  encerrado: "outline",
  vencido: "outline",
}

function formValues(announcement: PlatformAnnouncement): AnnouncementFormValues {
  return {
    title: announcement.title,
    body: announcement.body,
    kind: isAnnouncementKind(announcement.kind) ? announcement.kind : "informacao",
    audience: isAnnouncementAudience(announcement.audience) ? announcement.audience : "todos",
    startsAt: toBrasiliaInputValue(announcement.startsAt),
    endsAt: toBrasiliaInputValue(announcement.endsAt),
    linkUrl: announcement.linkUrl ?? "",
    linkLabel: announcement.linkLabel ?? "",
  }
}

function periodText(announcement: PlatformAnnouncement): string {
  const period = `De ${formatDateTime(announcement.startsAt)} até ${formatDateTime(announcement.endsAt)}`

  return announcement.endedAt
    ? `${period} · encerrado em ${formatDateTime(announcement.endedAt)}`
    : period
}

function AnnouncementCard({
  announcement,
  now,
  readOnly,
}: {
  announcement: PlatformAnnouncement
  now: Date
  readOnly: boolean
}) {
  const status = announcementStatus(announcement, now)
  const editable = status === "agendado" || status === "no_ar"
  const kindLabel = isAnnouncementKind(announcement.kind)
    ? ANNOUNCEMENT_KIND_LABELS[announcement.kind]
    : announcement.kind
  const audienceLabel = isAnnouncementAudience(announcement.audience)
    ? ANNOUNCEMENT_AUDIENCE_LABELS[announcement.audience]
    : announcement.audience

  return (
    <Card size="sm">
      <CardHeader>
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge variant={STATUS_VARIANTS[status]}>{ANNOUNCEMENT_STATUS_LABELS[status]}</Badge>
          <Badge variant="outline">{kindLabel}</Badge>
          <Badge variant="outline">{audienceLabel}</Badge>
        </div>
        <CardTitle className="break-words">{announcement.title}</CardTitle>
        <CardDescription>{periodText(announcement)}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-2 text-sm">
        <p className="break-words">{announcement.body}</p>
        {announcement.linkUrl ? (
          <a
            href={announcement.linkUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex w-fit max-w-full items-center gap-1 break-all underline underline-offset-3"
          >
            {announcement.linkLabel || ANNOUNCEMENT_DEFAULT_LINK_LABEL}
            <ExternalLinkIcon aria-hidden="true" className="size-3.5 shrink-0" />
            <span className="sr-only">(abre em outra aba)</span>
          </a>
        ) : null}
        <p className="text-muted-foreground">
          {announcement.dismissals === 0
            ? "Ninguém dispensou ainda."
            : `${formatNumber(announcement.dismissals)} ${announcement.dismissals === 1 ? "pessoa dispensou" : "pessoas dispensaram"}.`}
        </p>
      </CardContent>
      {editable ? (
        <CardFooter className="flex flex-wrap gap-2">
          <AnnouncementFormDialog
            announcementId={announcement.id}
            initialValues={formValues(announcement)}
            readOnly={readOnly}
          />
          <EndAnnouncementButton
            id={announcement.id}
            title={announcement.title}
            readOnly={readOnly}
          />
        </CardFooter>
      ) : null}
    </Card>
  )
}

export function AnnouncementsSection({
  title,
  description,
  announcements,
  now,
  readOnly = false,
}: {
  title: string
  description: string
  announcements: readonly PlatformAnnouncement[]
  now: Date
  /** Somente leitura: botões de editar e encerrar desabilitados. */
  readOnly?: boolean
}) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h2 className="text-base font-medium">{title}</h2>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      <ul className="grid gap-3 lg:grid-cols-2">
        {announcements.map((announcement) => (
          <li key={announcement.id} className="min-w-0">
            <AnnouncementCard announcement={announcement} now={now} readOnly={readOnly} />
          </li>
        ))}
      </ul>
    </section>
  )
}

import {
  DownloadIcon,
  EyeIcon,
  FileOutputIcon,
  HistoryIcon,
  PencilIcon,
  PlusIcon,
  PrinterIcon,
  TriangleAlertIcon,
} from "lucide-react"

import { PROPERTY_STATUS_LABELS } from "@workspace/core/properties/enums"
import { Alert, AlertDescription, AlertTitle } from "@workspace/ui/components/alert"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@workspace/ui/components/empty"
import {
  Item,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from "@workspace/ui/components/item"

import { formatDateTime } from "@/lib/format"
import { auditActionLabel, auditEntityLabel, auditFieldsSentence } from "@/lib/auditoria/labels"
import type { AuditEventItem, AuditEventsResult } from "@/lib/auditoria/queries"

const ACTION_ICONS: Record<string, typeof PencilIcon> = {
  insert: PlusIcon,
  update: PencilIcon,
  delete: TriangleAlertIcon,
  view: EyeIcon,
  download: DownloadIcon,
  export: FileOutputIcon,
  print: PrinterIcon,
}

function statusLabel(value: unknown) {
  if (typeof value !== "string") return null
  return PROPERTY_STATUS_LABELS[value as keyof typeof PROPERTY_STATUS_LABELS] ?? null
}

/** Uma frase explicando o que mudou naquele evento. */
function describe(event: AuditEventItem) {
  if (event.action === "update" && event.changedFields.length > 0) {
    const fields = auditFieldsSentence(event.entity, event.changedFields)
    const status =
      event.entity === "properties" && event.changedFields.includes("status")
        ? statusLabel(event.metadata.status)
        : null

    return status ? `Mudou ${fields}. Status agora: ${status}.` : `Mudou ${fields}.`
  }

  if (event.action === "insert" && event.entity === "properties") {
    const status = statusLabel(event.metadata.status)
    return status ? `Entrou como ${status}.` : null
  }

  if (event.action === "update") {
    return "Sem campos de negócio alterados."
  }

  return null
}

export function AuditTimeline({
  result,
  emptyDescription,
  retentionNote = "As alterações ficam guardadas por 180 dias. Só o dono e o gerente da imobiliária veem esta aba.",
}: {
  result: AuditEventsResult
  emptyDescription: string
  retentionNote?: string
}) {
  if (result.failed) {
    return (
      <Alert variant="destructive">
        <TriangleAlertIcon />
        <AlertTitle>Não foi possível carregar o histórico</AlertTitle>
        <AlertDescription>
          Pode ser uma instabilidade momentânea. Recarregue a página.
        </AlertDescription>
      </Alert>
    )
  }

  if (result.items.length === 0) {
    return (
      <Empty className="border">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <HistoryIcon />
          </EmptyMedia>
          <EmptyTitle>Nenhuma alteração registrada</EmptyTitle>
          <EmptyDescription>{emptyDescription}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      <ItemGroup className="gap-2" aria-label="Histórico de alterações">
        {result.items.map((event) => {
          const Icon = ACTION_ICONS[event.action] ?? HistoryIcon
          const detail = describe(event)

          return (
            <Item key={event.id} variant="outline" role="listitem">
              <ItemMedia variant="icon">
                <Icon />
              </ItemMedia>
              <ItemContent className="min-w-0">
                <ItemTitle>
                  {auditActionLabel(event.action)} {auditEntityLabel(event.entity)}
                  <span className="font-normal text-muted-foreground">
                    {formatDateTime(event.createdAt)} · {event.actorName ?? "Sistema"}
                  </span>
                </ItemTitle>
                {detail ? <ItemDescription>{detail}</ItemDescription> : null}
              </ItemContent>
            </Item>
          )
        })}
      </ItemGroup>
      <p className="text-xs text-muted-foreground">{retentionNote}</p>
    </div>
  )
}

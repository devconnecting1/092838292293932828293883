import Link from "next/link"
import { HistoryIcon } from "lucide-react"

import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@workspace/ui/components/empty"
import {
  Item,
  ItemActions,
  ItemContent,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from "@workspace/ui/components/item"

import { ACTIVITY_ICONS } from "@/components/clientes/activity-icons"
import { ConfirmDeleteButton } from "@/components/clientes/confirm-delete-button"
import { formatDateTime } from "@/lib/format"
import { deleteClientActivity } from "@/lib/clientes/activity-actions"
import { ACTIVITY_TYPE_LABELS } from "@/lib/clientes/constants"
import type { ClientActivityItem } from "@/lib/clientes/detail-queries"
import { getMemberName, type MemberOption } from "@/lib/clientes/options"

type ActivityTimelineProps = {
  clientId: string
  activities: ClientActivityItem[]
  members: MemberOption[]
  canDelete: boolean
}

export function ActivityTimeline({
  clientId,
  activities,
  members,
  canDelete,
}: ActivityTimelineProps) {
  if (activities.length === 0) {
    return (
      <Empty className="border">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <HistoryIcon />
          </EmptyMedia>
          <EmptyTitle>Nenhuma atividade registrada</EmptyTitle>
          <EmptyDescription>
            Ligações, mensagens, visitas e anotações sobre este cliente aparecem aqui.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }

  return (
    <ItemGroup className="gap-2" aria-label="Linha do tempo">
      {activities.map((activity) => {
        const Icon = ACTIVITY_ICONS[activity.type]

        return (
          <Item key={activity.id} variant="outline" role="listitem">
            <ItemMedia variant="icon">
              <Icon />
            </ItemMedia>
            <ItemContent className="min-w-0">
              <ItemTitle>
                {ACTIVITY_TYPE_LABELS[activity.type]}
                <span className="font-normal text-muted-foreground">
                  {formatDateTime(activity.occurredAt)} ·{" "}
                  {getMemberName(members, activity.createdBy, "Sistema")}
                </span>
              </ItemTitle>
              {activity.body ? (
                <p className="text-sm wrap-break-word whitespace-pre-wrap">{activity.body}</p>
              ) : null}
              {activity.property ? (
                <Link
                  href={`/imoveis/${activity.property.id}`}
                  className="w-fit text-sm text-muted-foreground underline-offset-4 hover:underline"
                >
                  {activity.property.code} · {activity.property.title}
                </Link>
              ) : null}
            </ItemContent>
            {canDelete ? (
              <ItemActions>
                <ConfirmDeleteButton
                  action={deleteClientActivity.bind(null, activity.id, clientId)}
                  label="Excluir atividade"
                  title="Excluir esta atividade?"
                  description="O registro sai da linha do tempo do cliente. Esta ação não pode ser desfeita."
                />
              </ItemActions>
            ) : null}
          </Item>
        )
      })}
    </ItemGroup>
  )
}

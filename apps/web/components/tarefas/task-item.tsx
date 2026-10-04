import Link from "next/link"
import {
  CalendarClockIcon,
  CircleCheckIcon,
  HouseIcon,
  UserIcon,
  UserRoundIcon,
} from "lucide-react"

import { Badge } from "@workspace/ui/components/badge"
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemMedia,
  ItemTitle,
} from "@workspace/ui/components/item"

import { TaskActions } from "@/components/tarefas/task-actions"
import { TaskPriorityBadge } from "@/components/tarefas/task-priority-badge"
import { TaskStatusCheckbox } from "@/components/tarefas/task-status-checkbox"
import { formatDateTime } from "@/lib/format"
import { formatTaskDue } from "@/lib/tarefas/format"
import type { TaskListItem } from "@/lib/tarefas/types"

type TaskItemProps = {
  task: TaskListItem
  assigneeName: string
  canEdit: boolean
  canDelete: boolean
}

/** Linha da lista de tarefas (Server Component com ilhas de cliente). */
export function TaskItem({ task, assigneeName, canEdit, canDelete }: TaskItemProps) {
  const isDone = task.status === "done"

  return (
    <Item role="listitem" className="items-start">
      <ItemMedia className="pt-0.5">
        <TaskStatusCheckbox taskId={task.id} title={task.title} done={isDone} disabled={!canEdit} />
      </ItemMedia>
      <ItemContent className="min-w-0">
        {/* Riscado segue o estado otimista do checkbox (data-checked). */}
        <ItemTitle className="group-has-data-checked/item:text-muted-foreground group-has-data-checked/item:line-through">
          {task.title}
        </ItemTitle>
        {task.description ? <ItemDescription>{task.description}</ItemDescription> : null}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 pt-1 text-xs text-muted-foreground">
          {isDone ? (
            <span className="inline-flex items-center gap-1">
              <CircleCheckIcon className="size-3.5" aria-hidden="true" />
              Concluída em {formatDateTime(task.completedAt)}
            </span>
          ) : task.dueAt ? (
            <span className="inline-flex items-center gap-1.5">
              <CalendarClockIcon className="size-3.5" aria-hidden="true" />
              <span className="sr-only">Prazo:</span>
              {formatTaskDue(task.dueAt)}
              {task.isOverdue ? <Badge variant="destructive">Atrasada</Badge> : null}
            </span>
          ) : null}
          <TaskPriorityBadge priority={task.priority} />
          <span className="inline-flex items-center gap-1">
            <UserIcon className="size-3.5" aria-hidden="true" />
            <span className="sr-only">Responsável:</span>
            {assigneeName}
          </span>
          {task.client ? (
            <Link
              href={`/clientes/${task.client.id}`}
              className="inline-flex max-w-full items-center gap-1 underline-offset-4 hover:text-foreground hover:underline"
            >
              <UserRoundIcon className="size-3.5 shrink-0" aria-hidden="true" />
              <span className="sr-only">Cliente:</span>
              <span className="truncate">{task.client.name}</span>
            </Link>
          ) : task.clientId ? (
            <span className="inline-flex items-center gap-1">
              <UserRoundIcon className="size-3.5" aria-hidden="true" />
              Cliente sem acesso
            </span>
          ) : null}
          {task.property ? (
            <Link
              href={`/imoveis/${task.property.id}`}
              className="inline-flex max-w-full items-center gap-1 underline-offset-4 hover:text-foreground hover:underline"
            >
              <HouseIcon className="size-3.5 shrink-0" aria-hidden="true" />
              <span className="sr-only">Imóvel:</span>
              <span className="truncate">
                {task.property.code} · {task.property.title}
              </span>
            </Link>
          ) : null}
        </div>
      </ItemContent>
      <ItemActions>
        <TaskActions
          task={{
            id: task.id,
            title: task.title,
            description: task.description,
            assigneeId: task.assigneeId,
            dueAt: task.dueAt,
            priority: task.priority,
            client: task.client
              ? {
                  id: task.client.id,
                  label: task.client.name,
                  description: null,
                }
              : null,
            property: task.property
              ? {
                  id: task.property.id,
                  label: `${task.property.code} · ${task.property.title}`,
                  description: null,
                }
              : null,
          }}
          canEdit={canEdit}
          canDelete={canDelete}
        />
      </ItemActions>
    </Item>
  )
}

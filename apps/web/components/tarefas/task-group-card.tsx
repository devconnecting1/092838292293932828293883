import { Fragment } from "react"

import { Badge } from "@workspace/ui/components/badge"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"
import { ItemGroup, ItemSeparator } from "@workspace/ui/components/item"

import { TaskItem } from "@/components/tarefas/task-item"
import type { Role } from "@/lib/auth/roles"
import { getMemberName, type MemberOption } from "@/lib/clientes/options"
import { canDeleteTask, canUpdateTask } from "@/lib/tarefas/permissions"
import type { TaskGroupKey, TaskListItem } from "@/lib/tarefas/types"

type TaskGroupCardProps = {
  groupKey: TaskGroupKey
  title: string
  description: string
  tasks: TaskListItem[]
  tone?: "default" | "destructive"
  members: MemberOption[]
  currentUserId: string
  role: Role
}

export function TaskGroupCard({
  groupKey,
  title,
  description,
  tasks,
  tone = "default",
  members,
  currentUserId,
  role,
}: TaskGroupCardProps) {
  const headingId = `tarefas-grupo-${groupKey}`

  return (
    <Card role="region" aria-labelledby={headingId}>
      <CardHeader>
        <CardTitle id={headingId}>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
        <CardAction>
          <Badge
            variant={tone === "destructive" ? "destructive" : "secondary"}
            aria-label={tasks.length === 1 ? "1 tarefa" : `${tasks.length} tarefas`}
          >
            {tasks.length}
          </Badge>
        </CardAction>
      </CardHeader>
      <CardContent>
        <ItemGroup className="gap-0">
          {tasks.map((task, index) => (
            <Fragment key={task.id}>
              {index > 0 ? <ItemSeparator className="my-0" /> : null}
              <TaskItem
                task={task}
                assigneeName={getMemberName(members, task.assigneeId, "Sem responsável")}
                canEdit={canUpdateTask(
                  role,
                  { assigneeId: task.assigneeId, createdBy: task.createdBy },
                  currentUserId
                )}
                canDelete={canDeleteTask(role, { createdBy: task.createdBy }, currentUserId)}
              />
            </Fragment>
          ))}
        </ItemGroup>
      </CardContent>
    </Card>
  )
}

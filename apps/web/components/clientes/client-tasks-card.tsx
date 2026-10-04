import Link from "next/link"
import { PlusIcon } from "lucide-react"

import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from "@workspace/ui/components/item"

import { TaskFormDialog } from "@/components/tarefas/task-form-dialog"
import { TaskPriorityBadge } from "@/components/tarefas/task-priority-badge"
import { TaskStatusCheckbox } from "@/components/tarefas/task-status-checkbox"
import type { Role } from "@/lib/auth/roles"
import type { ClientTaskItem } from "@/lib/clientes/detail-queries"
import { getMemberName, type ClientOption, type MemberOption } from "@/lib/clientes/options"
import { formatTaskDue } from "@/lib/tarefas/format"
import { canCreateTasks, canUpdateTask } from "@/lib/tarefas/permissions"

type ClientTasksCardProps = {
  openTasks: ClientTaskItem[]
  doneTasks: ClientTaskItem[]
  failed: boolean
  members: MemberOption[]
  client: ClientOption
  currentUserId: string
  role: Role
  now: Date
}

export function ClientTasksCard({
  openTasks,
  doneTasks,
  failed,
  members,
  client,
  currentUserId,
  role,
  now,
}: ClientTasksCardProps) {
  const tasks = [...openTasks, ...doneTasks]

  return (
    <Card>
      <CardHeader>
        <CardTitle>Tarefas</CardTitle>
        <CardDescription>Tarefas abertas e as últimas concluídas deste cliente.</CardDescription>
        {canCreateTasks(role) ? (
          <CardAction>
            <TaskFormDialog
              members={members}
              currentUserId={currentUserId}
              role={role}
              defaults={{ client }}
              trigger={<Button variant="outline" size="sm" />}
            >
              <PlusIcon data-icon="inline-start" />
              Nova tarefa
            </TaskFormDialog>
          </CardAction>
        ) : null}
      </CardHeader>
      <CardContent>
        {failed ? (
          <p className="text-sm text-destructive">Não foi possível carregar as tarefas.</p>
        ) : tasks.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhuma tarefa para este cliente.</p>
        ) : (
          <ItemGroup className="gap-1">
            {tasks.map((task) => {
              const done = task.status === "done"
              const overdue = !done && task.dueAt !== null && new Date(task.dueAt) < now

              return (
                <Item key={task.id} size="sm" variant="outline" role="listitem">
                  <ItemMedia>
                    <TaskStatusCheckbox
                      taskId={task.id}
                      title={task.title}
                      done={done}
                      disabled={
                        !canUpdateTask(
                          role,
                          {
                            assigneeId: task.assigneeId,
                            createdBy: task.createdBy,
                          },
                          currentUserId
                        )
                      }
                    />
                  </ItemMedia>
                  <ItemContent className="min-w-0">
                    <ItemTitle className={done ? "text-muted-foreground line-through" : undefined}>
                      {task.title}
                    </ItemTitle>
                    <ItemDescription>
                      {formatTaskDue(task.dueAt)} ·{" "}
                      {getMemberName(members, task.assigneeId, "Sem responsável")}
                      {task.property ? (
                        <>
                          {" · "}
                          <Link
                            href={`/imoveis/${task.property.id}`}
                            className="underline-offset-4 hover:underline"
                          >
                            {task.property.code}
                          </Link>
                        </>
                      ) : null}
                    </ItemDescription>
                  </ItemContent>
                  <ItemActions>
                    {overdue ? <Badge variant="destructive">Atrasada</Badge> : null}
                    {!done ? <TaskPriorityBadge priority={task.priority} /> : null}
                  </ItemActions>
                </Item>
              )
            })}
          </ItemGroup>
        )}
      </CardContent>
      <CardFooter>
        <Button
          variant="link"
          className="px-0"
          render={<Link href="/tarefas" />}
          nativeButton={false}
        >
          Ver todas as tarefas
        </Button>
      </CardFooter>
    </Card>
  )
}

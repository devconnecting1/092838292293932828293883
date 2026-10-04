import type { Metadata } from "next"
import Link from "next/link"
import { CircleCheckBigIcon, ListTodoIcon, SearchXIcon, TriangleAlertIcon } from "lucide-react"

import { Alert, AlertDescription, AlertTitle } from "@workspace/ui/components/alert"
import { Button } from "@workspace/ui/components/button"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@workspace/ui/components/empty"

import { PageHeading } from "@/components/crm/page-placeholder"
import { SupportHelpButton } from "@/components/crm/support-help-button"
import { PageShell } from "@/components/shared/page-shell"
import { NewTaskButton } from "@/components/tarefas/new-task-button"
import { TaskFilters } from "@/components/tarefas/task-filters"
import { TaskGroupCard } from "@/components/tarefas/task-group-card"
import { TaskListProvider } from "@/components/tarefas/task-list-context"
import { requireMembership } from "@/lib/auth/session"
import { getOrganizationMembers } from "@/lib/clientes/members"
import { TASK_ASSIGNEE_ME, parseTaskFilters } from "@/lib/tarefas/filters"
import { canCreateTasks } from "@/lib/tarefas/permissions"
import { DONE_TASKS_LIMIT, listTaskGroups } from "@/lib/tarefas/queries"
import type { TaskGroupKey } from "@/lib/tarefas/types"

export const metadata: Metadata = {
  title: "Tarefas",
}

const OPEN_GROUPS: {
  key: Exclude<TaskGroupKey, "done">
  title: string
  description: string
  tone?: "destructive"
}[] = [
  {
    key: "overdue",
    title: "Atrasadas",
    description: "O prazo passou e a tarefa continua aberta.",
    tone: "destructive",
  },
  { key: "today", title: "Hoje", description: "Vencem até o fim do dia." },
  {
    key: "upcoming",
    title: "Próximas",
    description: "Prazo a partir de amanhã.",
  },
  {
    key: "noDue",
    title: "Sem prazo",
    description: "Tarefas abertas sem data definida.",
  },
]

type SearchParams = Record<string, string | string[] | undefined>

export default async function TarefasPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>
}) {
  const [{ user, membership }, params] = await Promise.all([requireMembership(), searchParams])

  const filters = parseTaskFilters(params)
  const hasFilters = Boolean(filters.responsavel || filters.prioridade)
  const organizationId = membership.organizationId
  const role = membership.role

  const [members, result] = await Promise.all([
    getOrganizationMembers(organizationId),
    listTaskGroups(organizationId, {
      assigneeId: filters.responsavel === TASK_ASSIGNEE_ME ? user.id : filters.responsavel,
      priority: filters.prioridade,
    }),
  ])

  const canCreate = canCreateTasks(role)
  const groupProps = { members, currentUserId: user.id, role }

  let content: React.ReactNode

  if (!result.ok) {
    content = (
      <Alert variant="destructive">
        <TriangleAlertIcon />
        <AlertTitle>Não foi possível carregar as tarefas</AlertTitle>
        <AlertDescription className="flex flex-col items-start gap-2">
          <p>Recarregue a página. Se o problema continuar, chame o suporte.</p>
          <SupportHelpButton label="Chamar o suporte" />
        </AlertDescription>
      </Alert>
    )
  } else {
    const { groups } = result
    const openCount = OPEN_GROUPS.reduce((total, group) => total + groups[group.key].length, 0)

    if (openCount === 0 && groups.done.length === 0) {
      content = hasFilters ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <SearchXIcon />
            </EmptyMedia>
            <EmptyTitle>Nenhuma tarefa encontrada</EmptyTitle>
            <EmptyDescription>Nenhuma tarefa corresponde aos filtros escolhidos.</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button variant="outline" render={<Link href="/tarefas" />} nativeButton={false}>
              Limpar filtros
            </Button>
          </EmptyContent>
        </Empty>
      ) : (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <ListTodoIcon />
            </EmptyMedia>
            <EmptyTitle>Nenhuma tarefa por aqui</EmptyTitle>
            <EmptyDescription>
              Crie tarefas e lembretes com responsável e prazo para organizar o dia da equipe.
            </EmptyDescription>
          </EmptyHeader>
          {canCreate ? (
            <EmptyContent>
              <NewTaskButton />
            </EmptyContent>
          ) : null}
        </Empty>
      )
    } else {
      content = (
        <div className="flex flex-col gap-4">
          {openCount === 0 ? (
            <Empty className="border">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <CircleCheckBigIcon />
                </EmptyMedia>
                <EmptyTitle>Nenhuma tarefa pendente</EmptyTitle>
                <EmptyDescription>
                  {hasFilters
                    ? "Nada em aberto para os filtros escolhidos."
                    : "Tudo em dia. As tarefas concluídas estão logo abaixo."}
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            OPEN_GROUPS.filter((group) => groups[group.key].length > 0).map((group) => (
              <TaskGroupCard
                key={group.key}
                groupKey={group.key}
                title={group.title}
                description={group.description}
                tone={group.tone}
                tasks={groups[group.key]}
                {...groupProps}
              />
            ))
          )}
          {groups.done.length > 0 ? (
            <TaskGroupCard
              groupKey="done"
              title="Concluídas"
              description={`As ${DONE_TASKS_LIMIT} concluídas mais recentes.`}
              tasks={groups.done}
              {...groupProps}
            />
          ) : null}
        </div>
      )
    }
  }

  return (
    <TaskListProvider members={members} currentUserId={user.id} role={role}>
      <PageShell>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <PageHeading
            title="Tarefas"
            description="Tarefas e lembretes da equipe, com responsável e prazo."
          />
          {canCreate ? <NewTaskButton /> : null}
        </div>

        <TaskFilters />

        {content}
      </PageShell>
    </TaskListProvider>
  )
}

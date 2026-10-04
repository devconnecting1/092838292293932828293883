"use client"

import { XIcon } from "lucide-react"

import { TASK_PRIORITY_LABELS } from "@workspace/core/properties/enums"
import { Button } from "@workspace/ui/components/button"
import { Field, FieldGroup, FieldLabel, FieldTitle } from "@workspace/ui/components/field"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select"
import { Spinner } from "@workspace/ui/components/spinner"
import { ToggleGroup, ToggleGroupItem } from "@workspace/ui/components/toggle-group"

import { useTaskListContext } from "@/components/tarefas/task-list-context"
import { useFilterParams } from "@/components/tarefas/use-filter-params"
import { TASK_ASSIGNEE_ME } from "@/lib/tarefas/filters"
import { isTaskPriority, TASK_PRIORITIES } from "@/lib/tarefas/schemas"

const ALL_PRIORITIES = "todas"

export function TaskFilters() {
  const { members, currentUserId } = useTaskListContext()
  const { searchParams, setParams, isPending } = useFilterParams()

  const assigneeItems: { label: string; value: string | null }[] = [
    { label: "Todos os responsáveis", value: null },
    { label: "Minhas tarefas", value: TASK_ASSIGNEE_ME },
    ...members
      .filter((member) => member.id !== currentUserId)
      .map((member) => ({ label: member.name, value: member.id })),
  ]

  const assigneeParam = searchParams.get("responsavel")
  const assignee =
    assigneeParam === currentUserId
      ? TASK_ASSIGNEE_ME
      : assigneeItems.some((item) => item.value === assigneeParam)
        ? assigneeParam
        : null

  const priorityParam = searchParams.get("prioridade")
  const priority = isTaskPriority(priorityParam) ? priorityParam : null
  const hasFilters = Boolean(assignee || priority)

  return (
    <FieldGroup className="gap-3 md:flex-row md:flex-wrap md:items-end">
      <Field className="md:w-64">
        <FieldLabel htmlFor="tarefas-filtro-responsavel">Responsável</FieldLabel>
        <Select
          items={assigneeItems}
          value={assignee}
          onValueChange={(value: string | null) => setParams({ responsavel: value })}
        >
          <SelectTrigger id="tarefas-filtro-responsavel" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {assigneeItems.map((item) => (
                <SelectItem key={item.value ?? "todos"} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      </Field>
      <Field className="md:w-auto">
        <FieldTitle id="tarefas-filtro-prioridade">Prioridade</FieldTitle>
        <ToggleGroup
          aria-labelledby="tarefas-filtro-prioridade"
          variant="outline"
          value={[priority ?? ALL_PRIORITIES]}
          onValueChange={(value) => {
            const next = value[0]
            setParams({ prioridade: isTaskPriority(next) ? next : null })
          }}
        >
          <ToggleGroupItem value={ALL_PRIORITIES}>Todas</ToggleGroupItem>
          {TASK_PRIORITIES.map((item) => (
            <ToggleGroupItem key={item} value={item}>
              {TASK_PRIORITY_LABELS[item]}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </Field>
      {hasFilters ? (
        <Button
          variant="ghost"
          className="md:w-auto"
          onClick={() => setParams({ responsavel: null, prioridade: null })}
        >
          <XIcon data-icon="inline-start" />
          Limpar filtros
        </Button>
      ) : null}
      {isPending ? <Spinner className="self-center" aria-label="Atualizando a lista" /> : null}
    </FieldGroup>
  )
}

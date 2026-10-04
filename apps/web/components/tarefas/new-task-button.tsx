"use client"

import { PlusIcon } from "lucide-react"

import { Button } from "@workspace/ui/components/button"

import { TaskFormDialog } from "@/components/tarefas/task-form-dialog"
import { useTaskListContext } from "@/components/tarefas/task-list-context"

export function NewTaskButton({ variant = "default" }: { variant?: "default" | "outline" }) {
  const { members, currentUserId, role } = useTaskListContext()

  return (
    <TaskFormDialog
      members={members}
      currentUserId={currentUserId}
      role={role}
      trigger={<Button variant={variant} />}
    >
      <PlusIcon data-icon="inline-start" />
      Nova tarefa
    </TaskFormDialog>
  )
}

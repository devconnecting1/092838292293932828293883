"use client"

import * as React from "react"
import { MoreHorizontalIcon, PencilIcon, Trash2Icon } from "lucide-react"

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@workspace/ui/components/alert-dialog"
import { Button } from "@workspace/ui/components/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu"
import { Spinner } from "@workspace/ui/components/spinner"
import { toast } from "@workspace/ui/components/toast"

import {
  ControlledTaskFormDialog,
  type TaskFormDialogProps,
} from "@/components/tarefas/task-form-dialog"
import { useTaskListContext } from "@/components/tarefas/task-list-context"
import { deleteTask } from "@/lib/tarefas/actions"

type TaskActionsProps = {
  task: NonNullable<TaskFormDialogProps["task"]>
  canEdit: boolean
  canDelete: boolean
}

/** Menu de ações de um item da lista: editar e excluir, conforme permissões. */
export function TaskActions({ task, canEdit, canDelete }: TaskActionsProps) {
  const { members, currentUserId, role } = useTaskListContext()
  const [editOpen, setEditOpen] = React.useState(false)
  const [deleteOpen, setDeleteOpen] = React.useState(false)
  const [isDeleting, startDelete] = React.useTransition()

  if (!canEdit && !canDelete) {
    return null
  }

  function confirmDelete() {
    startDelete(async () => {
      const result = await deleteTask(task.id)

      if (!result.ok) {
        toast.add({
          title: "Não foi possível excluir a tarefa",
          description: result.error,
          type: "error",
        })
        return
      }

      toast.add({
        title: result.message ?? "Tarefa excluída.",
        type: "success",
      })
      setDeleteOpen(false)
    })
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" />}>
          <MoreHorizontalIcon />
          <span className="sr-only">Ações da tarefa {task.title}</span>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-44">
          {canEdit ? (
            <DropdownMenuGroup>
              <DropdownMenuItem onClick={() => setEditOpen(true)}>
                <PencilIcon />
                Editar
              </DropdownMenuItem>
            </DropdownMenuGroup>
          ) : null}
          {canEdit && canDelete ? <DropdownMenuSeparator /> : null}
          {canDelete ? (
            <DropdownMenuGroup>
              <DropdownMenuItem variant="destructive" onClick={() => setDeleteOpen(true)}>
                <Trash2Icon />
                Excluir
              </DropdownMenuItem>
            </DropdownMenuGroup>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>

      {canEdit ? (
        <ControlledTaskFormDialog
          open={editOpen}
          onOpenChange={setEditOpen}
          members={members}
          currentUserId={currentUserId}
          role={role}
          task={task}
        />
      ) : null}

      {canDelete ? (
        <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Excluir a tarefa?</AlertDialogTitle>
              <AlertDialogDescription>
                “{task.title}” será removida para toda a equipe. Essa ação não pode ser desfeita.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={isDeleting}>Cancelar</AlertDialogCancel>
              <AlertDialogAction
                variant="destructive"
                disabled={isDeleting}
                onClick={confirmDelete}
              >
                {isDeleting ? <Spinner data-icon="inline-start" /> : null}
                Excluir tarefa
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      ) : null}
    </>
  )
}

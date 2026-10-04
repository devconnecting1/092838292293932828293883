"use client"

import * as React from "react"

import { Checkbox } from "@workspace/ui/components/checkbox"
import { toast } from "@workspace/ui/components/toast"

import { setTaskStatus } from "@/lib/tarefas/actions"

/** Conclui ou reabre a tarefa com um clique, com atualização otimista. */
export function TaskStatusCheckbox({
  taskId,
  title,
  done,
  disabled,
}: {
  taskId: string
  title: string
  done: boolean
  disabled?: boolean
}) {
  const [optimisticDone, setOptimisticDone] = React.useOptimistic(done)
  const [isPending, startTransition] = React.useTransition()

  function handleCheckedChange(checked: boolean) {
    if (isPending) return

    startTransition(async () => {
      setOptimisticDone(checked)

      const result = await setTaskStatus(taskId, checked)

      if (!result.ok) {
        toast.add({
          title: checked
            ? "Não foi possível concluir a tarefa"
            : "Não foi possível reabrir a tarefa",
          description: result.error,
          type: "error",
        })
        return
      }

      toast.add({
        title: result.message ?? "Tarefa atualizada.",
        type: "success",
      })
    })
  }

  return (
    <Checkbox
      checked={optimisticDone}
      disabled={disabled}
      aria-busy={isPending || undefined}
      aria-label={`${optimisticDone ? "Reabrir" : "Concluir"} tarefa “${title}”`}
      onCheckedChange={handleCheckedChange}
    />
  )
}

"use client"

import * as React from "react"
import { Trash2Icon } from "lucide-react"

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@workspace/ui/components/alert-dialog"
import { Button } from "@workspace/ui/components/button"
import { Spinner } from "@workspace/ui/components/spinner"
import { toast } from "@workspace/ui/components/toast"

import type { ActionResult } from "@/lib/auth/action-result"

type ConfirmDeleteButtonProps = {
  /** Server Action já com os argumentos (ex.: `acao.bind(null, id)`). */
  action: () => Promise<ActionResult>
  /** Texto do botão (visível com `showLabel`, senão só para leitores de tela). */
  label: string
  title: string
  description: string
  confirmLabel?: string
  showLabel?: boolean
  onDone?: () => void
}

export function ConfirmDeleteButton({
  action,
  label,
  title,
  description,
  confirmLabel = "Excluir",
  showLabel = false,
  onDone,
}: ConfirmDeleteButtonProps) {
  const [open, setOpen] = React.useState(false)
  const [isPending, startTransition] = React.useTransition()

  function confirm() {
    startTransition(async () => {
      const result = await action()

      if (!result.ok) {
        toast.add({ title: result.error, type: "error" })
        return
      }

      toast.add({ title: result.message ?? "Excluído.", type: "success" })
      setOpen(false)
      onDone?.()
    })
  }

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger
        render={
          <Button
            variant={showLabel ? "outline" : "ghost"}
            size={showLabel ? "default" : "icon-sm"}
          />
        }
      >
        <Trash2Icon data-icon={showLabel ? "inline-start" : undefined} />
        {showLabel ? label : <span className="sr-only">{label}</span>}
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isPending}>Cancelar</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={confirm} disabled={isPending}>
            {isPending ? <Spinner data-icon="inline-start" /> : null}
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

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

import { deleteLead } from "@/lib/leads/actions"

type DeleteLeadButtonProps = {
  leadId: string
  leadName: string
  onDeleted: () => void
}

/** Exclusão do lead (dono/gerente), com confirmação. */
export function DeleteLeadButton({ leadId, leadName, onDeleted }: DeleteLeadButtonProps) {
  const [open, setOpen] = React.useState(false)
  const [isDeleting, startDelete] = React.useTransition()

  function confirm() {
    startDelete(async () => {
      const result = await deleteLead(leadId)

      if (!result.ok) {
        toast.add({
          title: "Não foi possível excluir",
          description: result.error,
          type: "error",
        })
        return
      }

      toast.add({ title: result.message ?? "Lead movido para a lixeira.", type: "success" })
      setOpen(false)
      onDeleted()
    })
  }

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger render={<Button variant="ghost" size="sm" />}>
        <Trash2Icon data-icon="inline-start" />
        Excluir lead
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Excluir este lead?</AlertDialogTitle>
          <AlertDialogDescription>
            {leadName} sai do funil, das buscas e dos relatórios e fica na lixeira por 30 dias (dono
            e gerente restauram em Configurações &gt; Lixeira). Depois é apagado de vez. Um cliente
            já criado a partir dele continua na base.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isDeleting}>Cancelar</AlertDialogCancel>
          <AlertDialogAction variant="destructive" disabled={isDeleting} onClick={confirm}>
            {isDeleting ? <Spinner data-icon="inline-start" /> : null}
            Excluir
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

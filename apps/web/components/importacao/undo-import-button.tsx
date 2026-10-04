"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { Undo2Icon } from "lucide-react"

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

import {
  undoImportJob,
  type ImportUndoCounts,
  type ImportUndoResult,
} from "@/lib/importacao/actions"
import { IMPORT_UNDO_DAYS } from "@/lib/importacao/constants"

const NETWORK_ERROR =
  "A conexão caiu no meio do desfazer. O que já saiu está salvo: tente de novo para terminar."

function total(counts: ImportUndoCounts) {
  return counts.clients + counts.leads + counts.properties
}

function describeUndo(result: ImportUndoResult) {
  const removed = total(result.removed)
  const kept = total(result.kept)
  const removedText =
    removed === 1 ? "1 cadastro removido" : `${removed.toLocaleString("pt-BR")} cadastros removidos`

  if (kept === 0) {
    return { title: "Importação desfeita", description: `${removedText}.` }
  }

  return {
    title: "Importação desfeita em parte",
    description: `${removedText}. ${
      kept === 1
        ? "1 cadastro ficou porque foi editado ou usado depois da importação"
        : `${kept.toLocaleString("pt-BR")} cadastros ficaram porque foram editados ou usados depois da importação`
    } (proposta, visita, tarefa, vínculo ou alteração).`,
  }
}

/** "Desfazer esta importação": confirma e repete o passo no servidor até terminar. */
export function UndoImportButton({
  jobId,
  onUndone,
  size = "default",
}: {
  jobId: string
  onUndone?: (result: ImportUndoResult) => void
  size?: "default" | "sm"
}) {
  const router = useRouter()
  const [open, setOpen] = React.useState(false)
  const [isPending, setIsPending] = React.useState(false)

  async function confirm() {
    setIsPending(true)

    try {
      for (let step = 0; step < 50; step += 1) {
        let result: Awaited<ReturnType<typeof undoImportJob>>

        try {
          result = await undoImportJob({ jobId })
        } catch {
          toast.add({ type: "error", title: NETWORK_ERROR })
          return
        }

        if (!result.ok) {
          toast.add({ type: "error", title: result.error })
          return
        }

        if (result.data.done) {
          const message = describeUndo(result.data)
          toast.add({ type: "success", title: message.title, description: message.description })
          setOpen(false)
          onUndone?.(result.data)
          router.refresh()
          return
        }
      }
    } finally {
      setIsPending(false)
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={(next) => (isPending ? undefined : setOpen(next))}>
      <AlertDialogTrigger render={<Button type="button" variant="outline" size={size} />}>
        <Undo2Icon data-icon="inline-start" />
        Desfazer esta importação
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Desfazer esta importação?</AlertDialogTitle>
          <AlertDialogDescription>
            Sai do CRM o que esta planilha criou: clientes, leads, imóveis, proprietários e fotos. O
            que alguém editou ou usou depois (proposta, visita, tarefa, novo vínculo) fica.
            Cadastros que já existiam e foram atualizados não voltam ao que eram. Vale por até{" "}
            {IMPORT_UNDO_DAYS} dias e não dá para refazer.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isPending}>Cancelar</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            onClick={() => void confirm()}
            disabled={isPending}
          >
            {isPending ? <Spinner data-icon="inline-start" /> : null}
            {isPending ? "Desfazendo…" : "Desfazer"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

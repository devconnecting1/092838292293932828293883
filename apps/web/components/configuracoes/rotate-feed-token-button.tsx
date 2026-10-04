"use client"

import * as React from "react"
import { RefreshCwIcon, TriangleAlertIcon } from "lucide-react"

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@workspace/ui/components/alert-dialog"
import { Button } from "@workspace/ui/components/button"
import { Spinner } from "@workspace/ui/components/spinner"
import { toast } from "@workspace/ui/components/toast"

import { rotateFeedToken } from "@/app/(app)/configuracoes/imobiliaria/actions"

export function RotateFeedTokenButton() {
  const [open, setOpen] = React.useState(false)
  const [isPending, startTransition] = React.useTransition()

  function onConfirm() {
    startTransition(async () => {
      const result = await rotateFeedToken()

      if (result.ok) {
        setOpen(false)
        toast.add({
          title: "Novo endereço do feed gerado",
          description: result.message,
          type: "success",
        })
        return
      }

      toast.add({
        title: "Não foi possível gerar",
        description: result.error,
        type: "error",
      })
    })
  }

  return (
    <AlertDialog open={open} onOpenChange={(next) => !isPending && setOpen(next)}>
      <AlertDialogTrigger render={<Button variant="outline" />}>
        <RefreshCwIcon data-icon="inline-start" />
        Gerar novo token
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogMedia>
            <TriangleAlertIcon />
          </AlertDialogMedia>
          <AlertDialogTitle>Gerar um novo endereço do feed?</AlertDialogTitle>
          <AlertDialogDescription>
            A URL atual para de funcionar na hora. Até você cadastrar a nova URL no Canal Pro, ZAP,
            Viva Real e OLX não conseguem atualizar seus anúncios. Faça isso só se o endereço tiver
            sido compartilhado com quem não devia.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isPending}>Cancelar</AlertDialogCancel>
          <AlertDialogAction variant="destructive" disabled={isPending} onClick={onConfirm}>
            {isPending ? <Spinner data-icon="inline-start" /> : null}
            Gerar novo token
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

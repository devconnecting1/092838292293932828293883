"use client"

import * as React from "react"
import { HandIcon } from "lucide-react"

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
import { Field, FieldError } from "@workspace/ui/components/field"
import { Spinner } from "@workspace/ui/components/spinner"
import { toast } from "@workspace/ui/components/toast"

import { takeOverIncidentAction } from "@/app/plataforma/status/actions"
import { PLATFORM_READ_ONLY_NOTICE_ID } from "@/components/plataforma/equipe/read-only-notice"

/**
 * "Assumir" um incidente detectado automaticamente: daí em diante a automação
 * não publica atualização, não resolve e não reabre esse incidente.
 */
export function TakeOverButton({
  incidentId,
  title,
  readOnly = false,
}: {
  incidentId: string
  title: string
  /** Somente leitura: botão desabilitado (o servidor recusa de qualquer jeito). */
  readOnly?: boolean
}) {
  const [open, setOpen] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [isPending, startTransition] = React.useTransition()

  function confirm() {
    setError(null)

    startTransition(async () => {
      const result = await takeOverIncidentAction(incidentId)

      if (!result.ok) {
        setError(result.error)
        return
      }

      toast.add({ title: result.message, type: "success" })
      setOpen(false)
    })
  }

  return (
    <AlertDialog
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen)
        if (!nextOpen) setError(null)
      }}
    >
      <AlertDialogTrigger
        render={
          <Button
            variant="outline"
            size="sm"
            disabled={readOnly}
            aria-describedby={readOnly ? PLATFORM_READ_ONLY_NOTICE_ID : undefined}
          />
        }
      >
        <HandIcon data-icon="inline-start" />
        Assumir
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Assumir este incidente?</AlertDialogTitle>
          <AlertDialogDescription>
            &ldquo;{title}&rdquo; passa a ser conduzido pela equipe: a automação deixa de publicar
            atualizações, de resolver e de reabrir este incidente. Publique você as próximas
            atualizações e o “Resolvido”.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {error ? (
          <Field data-invalid>
            <FieldError>{error}</FieldError>
          </Field>
        ) : null}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isPending}>Cancelar</AlertDialogCancel>
          <AlertDialogAction disabled={isPending} onClick={confirm}>
            {isPending ? <Spinner data-icon="inline-start" /> : null}
            Assumir agora
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

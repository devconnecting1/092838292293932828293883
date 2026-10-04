"use client"

import * as React from "react"
import { CircleStopIcon } from "lucide-react"

import { ANNOUNCEMENT_LIMITS } from "@workspace/core/platform/announcements"
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
import { Field, FieldDescription, FieldError, FieldLabel } from "@workspace/ui/components/field"
import { Spinner } from "@workspace/ui/components/spinner"
import { Textarea } from "@workspace/ui/components/textarea"
import { toast } from "@workspace/ui/components/toast"

import { endAnnouncementAction } from "@/app/plataforma/comunicados/actions"
import { PLATFORM_READ_ONLY_NOTICE_ID } from "@/components/plataforma/equipe/read-only-notice"

/** Tira o comunicado do ar agora, com motivo opcional para o registro. */
export function EndAnnouncementButton({
  id,
  title,
  readOnly = false,
}: {
  id: string
  title: string
  /** Somente leitura: botão desabilitado (o servidor recusa de qualquer jeito). */
  readOnly?: boolean
}) {
  const [open, setOpen] = React.useState(false)
  const [reason, setReason] = React.useState("")
  const [error, setError] = React.useState<string | null>(null)
  const [isPending, startTransition] = React.useTransition()
  const fieldId = `encerrar-motivo-${id}`

  function confirm() {
    setError(null)

    startTransition(async () => {
      const result = await endAnnouncementAction(id, reason)

      if (!result.ok) {
        setError(result.error)
        return
      }

      toast.add({ title: result.message, type: "success" })
      setOpen(false)
      setReason("")
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
        <CircleStopIcon data-icon="inline-start" />
        Encerrar
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Encerrar o comunicado?</AlertDialogTitle>
          <AlertDialogDescription>
            &ldquo;{title}&rdquo; sai do ar agora para todas as imobiliárias. Um comunicado
            encerrado não volta nem pode ser editado.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <Field data-invalid={error !== null}>
          <FieldLabel htmlFor={fieldId}>Motivo (opcional)</FieldLabel>
          <Textarea
            id={fieldId}
            rows={2}
            value={reason}
            maxLength={ANNOUNCEMENT_LIMITS.reasonMax}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Ex.: publicado por engano"
            aria-invalid={error !== null}
          />
          {error ? (
            <FieldError>{error}</FieldError>
          ) : (
            <FieldDescription>Fica no registro do console.</FieldDescription>
          )}
        </Field>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isPending}>Cancelar</AlertDialogCancel>
          <AlertDialogAction variant="destructive" disabled={isPending} onClick={confirm}>
            {isPending ? <Spinner data-icon="inline-start" /> : null}
            Encerrar agora
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

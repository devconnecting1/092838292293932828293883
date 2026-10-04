"use client"

import * as React from "react"

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
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@workspace/ui/components/field"
import { Input } from "@workspace/ui/components/input"
import { Spinner } from "@workspace/ui/components/spinner"
import { toast } from "@workspace/ui/components/toast"

import type { ActionResult } from "@/lib/auth/action-result"

function normalize(value: string) {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase("pt-BR")
}

type TypedConfirmDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  /** Explicação do que acontece (e do que fica, quando há guarda legal). */
  children: React.ReactNode
  /** Texto que a pessoa precisa digitar (nome do cliente/lead ou título do imóvel). */
  expected: string
  /** Alternativa aceita (código do imóvel). */
  alternative?: string | null
  confirmLabel: string
  action: (typed: string) => Promise<ActionResult>
  onDone?: () => void
}

/**
 * Confirmação de ação irreversível: só libera o botão quando o nome digitado
 * confere (o banco confere de novo).
 */
export function TypedConfirmDialog({
  open,
  onOpenChange,
  title,
  children,
  expected,
  alternative,
  confirmLabel,
  action,
  onDone,
}: TypedConfirmDialogProps) {
  const inputId = React.useId()
  const [typed, setTyped] = React.useState("")
  const [isPending, startTransition] = React.useTransition()

  const matches =
    typed.trim() !== "" &&
    (normalize(typed) === normalize(expected) ||
      (alternative ? normalize(typed) === normalize(alternative) : false))

  function handleOpenChange(next: boolean) {
    if (isPending) return
    if (!next) setTyped("")
    onOpenChange(next)
  }

  function confirm() {
    if (!matches) return

    startTransition(async () => {
      const result = await action(typed)

      if (!result.ok) {
        toast.add({ title: "Não foi possível concluir", description: result.error, type: "error" })
        return
      }

      toast.add({ title: result.message ?? "Pronto.", type: "success" })
      setTyped("")
      onOpenChange(false)
      onDone?.()
    })
  }

  return (
    <AlertDialog open={open} onOpenChange={handleOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription render={<div />} className="flex flex-col gap-2">
            {children}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor={inputId}>Digite “{expected}” para confirmar</FieldLabel>
            <Input
              id={inputId}
              value={typed}
              autoComplete="off"
              spellCheck={false}
              disabled={isPending}
              onChange={(event) => setTyped(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault()
                  confirm()
                }
              }}
            />
            {alternative ? (
              <FieldDescription>Também vale o código {alternative}.</FieldDescription>
            ) : null}
          </Field>
        </FieldGroup>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isPending}>Cancelar</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={!matches || isPending}
            onClick={(event) => {
              event.preventDefault()
              confirm()
            }}
          >
            {isPending ? <Spinner data-icon="inline-start" /> : null}
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

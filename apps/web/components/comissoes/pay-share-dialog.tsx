"use client"

import * as React from "react"
import { zodResolver } from "@hookform/resolvers/zod"
import { BanknoteIcon, CircleAlertIcon, Undo2Icon } from "lucide-react"
import { useForm } from "react-hook-form"

import { formatBRL } from "@workspace/core/billing/format"
import { Alert, AlertDescription, AlertTitle } from "@workspace/ui/components/alert"
import { Button } from "@workspace/ui/components/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@workspace/ui/components/dialog"
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@workspace/ui/components/field"
import { Input } from "@workspace/ui/components/input"
import { Spinner } from "@workspace/ui/components/spinner"
import { Textarea } from "@workspace/ui/components/textarea"
import { toast } from "@workspace/ui/components/toast"

import { payCommissionShare, reopenCommissionShare } from "@/lib/comissoes/actions"
import { payShareSchema, type PayShareValues } from "@/lib/comissoes/schemas"

function today() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date())
}

export function PayShareDialog({
  shareId,
  amountCents,
  who,
  deal,
}: {
  shareId: string
  amountCents: number
  who: string
  deal: string
}) {
  const [open, setOpen] = React.useState(false)
  const [isPending, startTransition] = React.useTransition()
  const [formError, setFormError] = React.useState<string | null>(null)

  const form = useForm<PayShareValues>({
    resolver: zodResolver(payShareSchema),
    mode: "onTouched",
    defaultValues: { shareId, paidOn: today(), note: "" },
  })

  function onSubmit(values: PayShareValues) {
    setFormError(null)

    startTransition(async () => {
      const result = await payCommissionShare(values)

      if (result.ok) {
        toast.add({ title: result.message ?? "Parte marcada como paga.", type: "success" })
        setOpen(false)
        return
      }

      for (const [field, message] of Object.entries(result.fieldErrors ?? {})) {
        if (message) {
          form.setError(field as keyof PayShareValues, { type: "server", message })
        }
      }

      setFormError(result.error)
    })
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (isPending) return
        if (nextOpen) {
          setFormError(null)
          form.reset({ shareId, paidOn: today(), note: "" })
        }
        setOpen(nextOpen)
      }}
    >
      <DialogTrigger render={<Button variant="outline" size="sm" />}>
        <BanknoteIcon data-icon="inline-start" />
        Marcar como pago
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Registrar pagamento de {formatBRL(amountCents)}</DialogTitle>
          <DialogDescription>
            {who} · {deal}
          </DialogDescription>
        </DialogHeader>

        <form id={`pagar-${shareId}`} onSubmit={form.handleSubmit(onSubmit)} noValidate>
          <FieldGroup>
            {formError ? (
              <Alert variant="destructive">
                <CircleAlertIcon />
                <AlertTitle>Não foi possível registrar</AlertTitle>
                <AlertDescription>{formError}</AlertDescription>
              </Alert>
            ) : null}

            <Field data-invalid={Boolean(form.formState.errors.paidOn)}>
              <FieldLabel htmlFor={`data-${shareId}`}>Data do pagamento</FieldLabel>
              <Input
                id={`data-${shareId}`}
                type="date"
                max={today()}
                {...form.register("paidOn")}
              />
              {form.formState.errors.paidOn ? (
                <FieldError errors={[form.formState.errors.paidOn]} />
              ) : (
                <FieldDescription>Em branco, entra a data de hoje.</FieldDescription>
              )}
            </Field>

            <Field>
              <FieldLabel htmlFor={`obs-${shareId}`}>Observação (opcional)</FieldLabel>
              <Textarea
                id={`obs-${shareId}`}
                rows={2}
                maxLength={500}
                placeholder="Ex.: pago junto com a folha de março."
                {...form.register("note")}
              />
            </Field>
          </FieldGroup>
        </form>

        <DialogFooter>
          <DialogClose render={<Button variant="outline" />} disabled={isPending}>
            Cancelar
          </DialogClose>
          <Button type="submit" form={`pagar-${shareId}`} disabled={isPending}>
            {isPending ? <Spinner data-icon="inline-start" /> : null}
            Registrar pagamento
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function ReopenShareButton({ shareId }: { shareId: string }) {
  const [isPending, startTransition] = React.useTransition()

  function onClick() {
    startTransition(async () => {
      const result = await reopenCommissionShare(shareId)

      if (result.ok) {
        toast.add({ title: result.message ?? "Pagamento desfeito.", type: "success" })
        return
      }

      toast.add({
        title: "Não foi possível desfazer",
        description: result.error,
        type: "error",
      })
    })
  }

  return (
    <Button variant="ghost" size="sm" onClick={onClick} disabled={isPending}>
      {isPending ? <Spinner data-icon="inline-start" /> : <Undo2Icon data-icon="inline-start" />}
      Desfazer
    </Button>
  )
}

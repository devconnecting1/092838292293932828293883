"use client"

import * as React from "react"
import { zodResolver } from "@hookform/resolvers/zod"
import { CircleAlertIcon, HandshakeIcon } from "lucide-react"
import { useForm, useWatch } from "react-hook-form"

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
import { toast } from "@workspace/ui/components/toast"

import { PercentField } from "@/components/comissoes/commission-fields"
import { setCommissionPartner } from "@/lib/comissoes/actions"
import { commissionPartnerSchema, type CommissionPartnerValues } from "@/lib/comissoes/schemas"

/**
 * Parceiro externo de um negócio já fechado. A parte dele sai da fatia da
 * imobiliária (a RPC recusa se não couber), então a soma continua fechando.
 */
export function PartnerDialog({
  commissionId,
  totalCents,
  agencyCents,
  partnerName,
  partnerPercent,
  deal,
}: {
  commissionId: string
  totalCents: number
  agencyCents: number
  partnerName: string | null
  partnerPercent: number
  deal: string
}) {
  const [open, setOpen] = React.useState(false)
  const [isPending, startTransition] = React.useTransition()
  const [formError, setFormError] = React.useState<string | null>(null)

  const defaults: CommissionPartnerValues = {
    commissionId,
    partnerName: partnerName ?? "",
    percent: partnerName ? partnerPercent : 0,
  }

  const form = useForm<CommissionPartnerValues>({
    resolver: zodResolver(commissionPartnerSchema),
    mode: "onTouched",
    defaultValues: defaults,
  })

  const percent = useWatch({ control: form.control, name: "percent" })
  const preview = Number.isFinite(percent) ? Math.round((totalCents * percent) / 100) : 0

  function onSubmit(values: CommissionPartnerValues) {
    setFormError(null)

    startTransition(async () => {
      const result = await setCommissionPartner(values)

      if (result.ok) {
        toast.add({ title: result.message ?? "Parceiro atualizado.", type: "success" })
        setOpen(false)
        return
      }

      for (const [field, message] of Object.entries(result.fieldErrors ?? {})) {
        if (message) {
          form.setError(field as keyof CommissionPartnerValues, { type: "server", message })
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
          form.reset(defaults)
        }
        setOpen(nextOpen)
      }}
    >
      <DialogTrigger render={<Button variant="ghost" size="sm" />}>
        <HandshakeIcon data-icon="inline-start" />
        {partnerName ? "Editar parceiro" : "Registrar parceiro"}
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Parceiro externo</DialogTitle>
          <DialogDescription>{deal}</DialogDescription>
        </DialogHeader>

        <form id={`parceiro-${commissionId}`} onSubmit={form.handleSubmit(onSubmit)} noValidate>
          <FieldGroup>
            {formError ? (
              <Alert variant="destructive">
                <CircleAlertIcon />
                <AlertTitle>Não foi possível salvar</AlertTitle>
                <AlertDescription>{formError}</AlertDescription>
              </Alert>
            ) : null}

            <Field data-invalid={Boolean(form.formState.errors.partnerName)}>
              <FieldLabel htmlFor={`parceiro-nome-${commissionId}`}>
                Imobiliária ou corretor parceiro
              </FieldLabel>
              <Input
                id={`parceiro-nome-${commissionId}`}
                maxLength={160}
                autoComplete="off"
                placeholder="Nome de quem dividiu o negócio"
                {...form.register("partnerName")}
              />
              {form.formState.errors.partnerName ? (
                <FieldError errors={[form.formState.errors.partnerName]} />
              ) : (
                <FieldDescription>
                  Deixe em branco para remover o parceiro e devolver o valor à imobiliária.
                </FieldDescription>
              )}
            </Field>

            <PercentField
              control={form.control}
              name="percent"
              id={`parceiro-percentual-${commissionId}`}
              label="Percentual da comissão"
              description={`Sai da parte da imobiliária, que hoje está em ${formatBRL(agencyCents)}.`}
            />

            <Alert>
              <HandshakeIcon />
              <AlertTitle>O parceiro recebe {formatBRL(preview)}</AlertTitle>
              <AlertDescription>
                A imobiliária fica com {formatBRL(Math.max(agencyCents - preview, 0))}. O total da
                comissão ({formatBRL(totalCents)}) não muda.
              </AlertDescription>
            </Alert>
          </FieldGroup>
        </form>

        <DialogFooter>
          <DialogClose render={<Button variant="outline" />} disabled={isPending}>
            Cancelar
          </DialogClose>
          <Button type="submit" form={`parceiro-${commissionId}`} disabled={isPending}>
            {isPending ? <Spinner data-icon="inline-start" /> : null}
            Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

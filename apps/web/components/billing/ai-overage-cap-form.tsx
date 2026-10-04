"use client"

import * as React from "react"
import { zodResolver } from "@hookform/resolvers/zod"
import { CircleAlertIcon } from "lucide-react"
import { Controller, useForm } from "react-hook-form"

import { formatBRL } from "@workspace/core/billing"
import { Alert, AlertDescription, AlertTitle } from "@workspace/ui/components/alert"
import { Button } from "@workspace/ui/components/button"
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@workspace/ui/components/field"
import { Spinner } from "@workspace/ui/components/spinner"
import { toast } from "@workspace/ui/components/toast"

import { updateAiOverageCap } from "@/app/(app)/configuracoes/assinatura/actions"
import { MoneyInput } from "@/components/imoveis/money-input"
import { aiOverageCapSchema, type AiOverageCapValues } from "@/lib/ai/schemas"
import { formatBrlInputValue } from "@/lib/imoveis/number"

type AiOverageCapFormProps = {
  overageCapCents: number
  maxOverageCapCents: number
  canManage: boolean
}

function toFieldValue(cents: number) {
  return cents > 0 ? formatBrlInputValue(cents / 100) : ""
}

/** Teto de excedente de IA por ciclo, em reais. Em branco (0) = a IA para na franquia. */
export function AiOverageCapForm({
  overageCapCents,
  maxOverageCapCents,
  canManage,
}: AiOverageCapFormProps) {
  const [isPending, startTransition] = React.useTransition()
  const [formError, setFormError] = React.useState<string | null>(null)

  const form = useForm<AiOverageCapValues>({
    resolver: zodResolver(aiOverageCapSchema),
    mode: "onTouched",
    defaultValues: { overageCap: toFieldValue(overageCapCents) },
  })

  if (!canManage) {
    return (
      <p className="text-sm text-muted-foreground">
        Excedente de IA:{" "}
        {overageCapCents > 0
          ? `liberado até ${formatBRL(overageCapCents)} por ciclo`
          : "desligado (a IA para quando a franquia acabar)"}
        . Só o dono ou o gerente pode alterar.
      </p>
    )
  }

  function onSubmit(values: AiOverageCapValues) {
    setFormError(null)

    startTransition(async () => {
      const result = await updateAiOverageCap(values)

      if (result.ok) {
        toast.add({ title: result.message ?? "Teto de excedente salvo.", type: "success" })
        form.reset(values)
        return
      }

      const fieldError = result.fieldErrors?.overageCap

      if (fieldError) {
        form.setError("overageCap", { type: "server", message: fieldError })
      }

      setFormError(result.error)
    })
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} noValidate>
      <FieldGroup>
        {formError ? (
          <Alert variant="destructive">
            <CircleAlertIcon />
            <AlertTitle>Não foi possível salvar</AlertTitle>
            <AlertDescription>{formError}</AlertDescription>
          </Alert>
        ) : null}

        <Controller
          name="overageCap"
          control={form.control}
          render={({ field, fieldState }) => (
            <Field data-invalid={fieldState.invalid}>
              <FieldLabel htmlFor="ia-teto-excedente">Teto de excedente por ciclo</FieldLabel>
              <MoneyInput
                id="ia-teto-excedente"
                name={field.name}
                ref={field.ref}
                value={field.value}
                onValueChange={field.onChange}
                onBlur={field.onBlur}
                suffix="/ciclo"
                aria-invalid={fieldState.invalid}
              />
              {fieldState.invalid ? (
                <FieldError errors={[fieldState.error]} />
              ) : (
                <FieldDescription>
                  Quanto a imobiliária aceita gastar de IA além da franquia, por ciclo. Em branco
                  (ou zero) a IA simplesmente para quando a franquia acabar — nunca há cobrança
                  surpresa. Máximo de {formatBRL(maxOverageCapCents)}.
                </FieldDescription>
              )}
            </Field>
          )}
        />

        <Field orientation="horizontal" className="justify-end">
          <Button type="submit" disabled={isPending || !form.formState.isDirty}>
            {isPending ? <Spinner data-icon="inline-start" /> : null}
            Salvar teto
          </Button>
        </Field>
      </FieldGroup>
    </form>
  )
}

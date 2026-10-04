"use client"

import * as React from "react"
import { zodResolver } from "@hookform/resolvers/zod"
import { Controller, useForm } from "react-hook-form"

import { Button } from "@workspace/ui/components/button"
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldTitle,
} from "@workspace/ui/components/field"
import { Spinner } from "@workspace/ui/components/spinner"
import { Textarea } from "@workspace/ui/components/textarea"
import { toast } from "@workspace/ui/components/toast"
import { ToggleGroup, ToggleGroupItem } from "@workspace/ui/components/toggle-group"

import { ACTIVITY_ICONS } from "@/components/clientes/activity-icons"
import { createClientActivity } from "@/lib/clientes/activity-actions"
import { activityFormSchema, type ActivityFormValues } from "@/lib/clientes/activity-schema"
import { ACTIVITY_TYPE_LABELS, MANUAL_ACTIVITY_TYPES } from "@/lib/clientes/constants"

type LeadActivityFormProps = {
  clientId: string
  onSaved: () => void
}

/** Anotação no histórico do cliente vinculado ao lead (tabela activities). */
export function LeadActivityForm({ clientId, onSaved }: LeadActivityFormProps) {
  const [isPending, startTransition] = React.useTransition()

  const form = useForm<ActivityFormValues>({
    resolver: zodResolver(activityFormSchema),
    defaultValues: { type: "note", body: "" },
  })

  function onSubmit(values: ActivityFormValues) {
    startTransition(async () => {
      const result = await createClientActivity(clientId, values)

      if (!result.ok) {
        toast.add({
          title: "Não foi possível registrar",
          description: result.error,
          type: "error",
        })
        return
      }

      toast.add({
        title: result.message ?? "Atividade registrada.",
        type: "success",
      })
      form.reset({ type: values.type, body: "" })
      onSaved()
    })
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} noValidate>
      <FieldGroup className="gap-3">
        <Controller
          control={form.control}
          name="type"
          render={({ field }) => (
            <Field>
              <FieldTitle id="lead-atividade-tipo">Registrar no histórico</FieldTitle>
              <ToggleGroup
                aria-labelledby="lead-atividade-tipo"
                variant="outline"
                size="sm"
                className="flex-wrap"
                value={[field.value]}
                onValueChange={(value: string[]) => {
                  const next = MANUAL_ACTIVITY_TYPES.find((type) => type === value[0])
                  if (next) field.onChange(next)
                }}
              >
                {MANUAL_ACTIVITY_TYPES.map((type) => {
                  const Icon = ACTIVITY_ICONS[type]

                  return (
                    <ToggleGroupItem key={type} value={type}>
                      <Icon data-icon="inline-start" />
                      {ACTIVITY_TYPE_LABELS[type]}
                    </ToggleGroupItem>
                  )
                })}
              </ToggleGroup>
            </Field>
          )}
        />
        <Controller
          control={form.control}
          name="body"
          render={({ field, fieldState }) => (
            <Field data-invalid={fieldState.invalid}>
              <FieldLabel htmlFor="lead-atividade-texto" className="sr-only">
                Descrição
              </FieldLabel>
              <Textarea
                {...field}
                id="lead-atividade-texto"
                rows={3}
                placeholder="Ex.: ligou pedindo mais fotos; prefere visitar no sábado."
                aria-invalid={fieldState.invalid}
              />
              {fieldState.invalid ? <FieldError errors={[fieldState.error]} /> : null}
            </Field>
          )}
        />
        <Field orientation="horizontal" className="justify-end">
          <Button type="submit" size="sm" disabled={isPending}>
            {isPending ? <Spinner data-icon="inline-start" /> : null}
            Registrar
          </Button>
        </Field>
      </FieldGroup>
    </form>
  )
}

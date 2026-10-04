"use client"

import * as React from "react"
import { zodResolver } from "@hookform/resolvers/zod"
import { CircleAlertIcon, RotateCcwIcon, TriangleAlertIcon } from "lucide-react"
import { Controller, useForm, useWatch } from "react-hook-form"

import { formatBRL } from "@workspace/core/billing/format"
import {
  DEFAULT_STAGE_PROBABILITIES,
  describeProbabilityOrder,
  FORECAST_OPEN_STAGES,
  FORECAST_STAGE_LABELS,
  isDefaultStageProbabilities,
  isValidProbability,
  weightedAmountCents,
  weightedPipelineCents,
  type ForecastOpenStage,
  type StageProbabilities,
} from "@workspace/core/reports/stage-probabilities"
import { Alert, AlertDescription, AlertTitle } from "@workspace/ui/components/alert"
import { Button } from "@workspace/ui/components/button"
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@workspace/ui/components/field"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
} from "@workspace/ui/components/input-group"
import { Spinner } from "@workspace/ui/components/spinner"
import { toast } from "@workspace/ui/components/toast"

import { resetStageProbabilities, saveStageProbabilities } from "@/lib/previsao/actions"
import { stageProbabilitiesSchema } from "@/lib/previsao/schemas"

const STAGE_HINTS: Record<ForecastOpenStage, string> = {
  draft: "Proposta ainda não apresentada.",
  sent: "Apresentada ao proprietário, aguardando resposta.",
  countered: "O outro lado respondeu com outra condição.",
}

/** Exemplo fixo da explicação: 2 enviadas de R$ 500 mil e 1 contraproposta de R$ 400 mil. */
const EXAMPLE = [
  { stage: "sent", amountCents: 50_000_000 },
  { stage: "sent", amountCents: 50_000_000 },
  { stage: "countered", amountCents: 40_000_000 },
] as const

function safeValues(values: Partial<StageProbabilities>): StageProbabilities {
  return {
    draft: isValidProbability(values.draft) ? values.draft : 0,
    sent: isValidProbability(values.sent) ? values.sent : 0,
    countered: isValidProbability(values.countered) ? values.countered : 0,
  }
}

export function StageProbabilitiesForm({
  defaultValues,
  usingDefaults,
  canEdit,
}: {
  defaultValues: StageProbabilities
  usingDefaults: boolean
  canEdit: boolean
}) {
  const [isSaving, startSaving] = React.useTransition()
  const [isResetting, startResetting] = React.useTransition()
  const [formError, setFormError] = React.useState<string | null>(null)
  const isPending = isSaving || isResetting

  const form = useForm<StageProbabilities>({
    resolver: zodResolver(stageProbabilitiesSchema),
    mode: "onTouched",
    defaultValues,
  })

  const watched = useWatch({ control: form.control })
  const current = safeValues(watched)
  const orderWarning = describeProbabilityOrder(current)
  const exampleTotal = weightedPipelineCents(EXAMPLE, current)

  function onSubmit(values: StageProbabilities) {
    setFormError(null)

    startSaving(async () => {
      const result = await saveStageProbabilities(values)

      if (result.ok) {
        toast.add({ title: result.message ?? "Probabilidades salvas.", type: "success" })
        form.reset(values)
        return
      }

      for (const [field, message] of Object.entries(result.fieldErrors ?? {})) {
        if (message) {
          form.setError(field as keyof StageProbabilities, { type: "server", message })
        }
      }

      setFormError(result.error)
    })
  }

  function onReset() {
    setFormError(null)

    startResetting(async () => {
      const result = await resetStageProbabilities()

      if (result.ok) {
        toast.add({ title: result.message ?? "Padrão restaurado.", type: "success" })
        form.reset({ ...DEFAULT_STAGE_PROBABILITIES })
        return
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

        <div className="grid gap-5 @min-[40rem]/page:grid-cols-3">
          {FORECAST_OPEN_STAGES.map((stage) => (
            <Controller
              key={stage}
              control={form.control}
              name={stage}
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid} data-disabled={!canEdit || undefined}>
                  <FieldLabel htmlFor={`previsao-${stage}`}>
                    {FORECAST_STAGE_LABELS[stage]}
                  </FieldLabel>
                  <InputGroup>
                    <InputGroupInput
                      id={`previsao-${stage}`}
                      name={field.name}
                      ref={field.ref}
                      type="number"
                      inputMode="numeric"
                      min={0}
                      max={100}
                      step={1}
                      disabled={!canEdit || isPending}
                      value={Number.isFinite(field.value) ? String(field.value) : ""}
                      onBlur={field.onBlur}
                      onChange={(event) =>
                        field.onChange(
                          event.target.value === "" ? Number.NaN : event.target.valueAsNumber
                        )
                      }
                      aria-invalid={fieldState.invalid}
                    />
                    <InputGroupAddon align="inline-end">
                      <InputGroupText>%</InputGroupText>
                    </InputGroupAddon>
                  </InputGroup>
                  {fieldState.invalid ? (
                    <FieldError errors={[fieldState.error]} />
                  ) : (
                    <FieldDescription>
                      {STAGE_HINTS[stage]} Padrão: {DEFAULT_STAGE_PROBABILITIES[stage]}%.
                    </FieldDescription>
                  )}
                </Field>
              )}
            />
          ))}
        </div>

        {orderWarning ? (
          <Alert>
            <TriangleAlertIcon />
            <AlertTitle>Confira a ordem</AlertTitle>
            <AlertDescription>{orderWarning}</AlertDescription>
          </Alert>
        ) : null}

        <div className="rounded-lg border bg-muted/40 p-4 text-sm">
          <p className="font-medium">Exemplo com estes valores</p>
          <ul className="mt-2 flex flex-col gap-1 text-muted-foreground">
            <li>
              2 propostas enviadas de {formatBRL(50_000_000, { omitZeroCents: true })} a{" "}
              {current.sent}% = {formatBRL(2 * weightedAmountCents(50_000_000, current.sent))}
            </li>
            <li>
              1 contraproposta de {formatBRL(40_000_000, { omitZeroCents: true })} a{" "}
              {current.countered}% = {formatBRL(weightedAmountCents(40_000_000, current.countered))}
            </li>
          </ul>
          <p className="mt-2">
            Previsão ponderada: <span className="font-semibold">{formatBRL(exampleTotal)}</span>
          </p>
        </div>

        {canEdit ? (
          <Field orientation="horizontal" className="flex-wrap justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={onReset}
              disabled={
                isPending ||
                (usingDefaults && isDefaultStageProbabilities(current) && !form.formState.isDirty)
              }
            >
              {isResetting ? (
                <Spinner data-icon="inline-start" />
              ) : (
                <RotateCcwIcon data-icon="inline-start" />
              )}
              Voltar ao padrão
            </Button>
            <Button type="submit" disabled={isPending || !form.formState.isDirty}>
              {isSaving ? <Spinner data-icon="inline-start" /> : null}
              Salvar probabilidades
            </Button>
          </Field>
        ) : null}
      </FieldGroup>
    </form>
  )
}

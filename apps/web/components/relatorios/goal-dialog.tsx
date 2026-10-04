"use client"

import * as React from "react"
import { zodResolver } from "@hookform/resolvers/zod"
import { CircleAlertIcon, CopyIcon, TargetIcon } from "lucide-react"
import { Controller, useForm } from "react-hook-form"

import {
  GOAL_METRIC_DESCRIPTIONS,
  GOAL_METRIC_LABELS,
  GOAL_METRICS,
  isGoalAmountMetric,
  type GoalMetric,
} from "@workspace/core/reports/sales-goals"
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
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
} from "@workspace/ui/components/input-group"
import { Spinner } from "@workspace/ui/components/spinner"
import { toast } from "@workspace/ui/components/toast"

import { useGuardedSubmit, type SubmitFailure } from "@/lib/forms/submit/use-guarded-submit"
import { maskBrlInput } from "@/lib/propostas/money"
import { copySalesGoalsFromPreviousMonth, saveSalesGoal } from "@/lib/relatorios/actions"
import { goalFormSchema, type GoalFormValues } from "@/lib/relatorios/goal-schemas"

type GoalDialogProps = {
  month: string
  monthLabel: string
  kind: "team" | "broker"
  targetId: string
  targetName: string
  initialValues: GoalFormValues
  /** Já existe meta para este mês (muda o texto do botão). */
  hasGoal: boolean
}

/** Botão + diálogo para definir as metas do mês de um corretor ou de uma equipe. */
export function GoalDialog(props: GoalDialogProps) {
  const [open, setOpen] = React.useState(false)

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button type="button" variant="outline" size="sm" />}>
        <TargetIcon data-icon="inline-start" />
        {props.hasGoal ? "Editar metas" : "Definir metas"}
      </DialogTrigger>
      <DialogContent className="max-h-[calc(100svh-2rem)] overflow-y-auto sm:max-w-xl">
        {/* O formulário monta a cada abertura, com os valores atuais. */}
        {open ? <GoalForm {...props} onDone={() => setOpen(false)} /> : null}
      </DialogContent>
    </Dialog>
  )
}

function GoalForm({
  month,
  monthLabel,
  kind,
  targetId,
  targetName,
  initialValues,
  onDone,
}: GoalDialogProps & { onDone: () => void }) {
  const { isPending, run } = useGuardedSubmit()
  const [formError, setFormError] = React.useState<string | null>(null)
  const form = useForm<GoalFormValues>({
    resolver: zodResolver(goalFormSchema),
    mode: "onTouched",
    defaultValues: initialValues,
  })

  function onFailure({ message }: SubmitFailure) {
    setFormError(message)
  }

  function onSubmit(values: GoalFormValues) {
    setFormError(null)

    run(async () => {
      const result = await saveSalesGoal({ month, kind, targetId, values })

      if (!result.ok) {
        setFormError(result.error)
        return
      }

      toast.add({ title: result.message ?? "Meta salva.", type: "success" })
      onDone()
    }, onFailure)
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Metas de {targetName}</DialogTitle>
        <DialogDescription>
          <span className="capitalize">{monthLabel}</span>
          {kind === "team"
            ? ". A meta da equipe é comparada com a soma dos membros atuais."
            : "."}{" "}
          Deixe em branco o indicador sem meta.
        </DialogDescription>
      </DialogHeader>
      <form onSubmit={form.handleSubmit(onSubmit)} noValidate className="flex flex-col gap-6">
        <FieldGroup>
          {formError ? (
            <Alert variant="destructive">
              <CircleAlertIcon />
              <AlertTitle>Não foi possível salvar</AlertTitle>
              <AlertDescription>{formError}</AlertDescription>
            </Alert>
          ) : null}
          <div className="grid gap-5 sm:grid-cols-2">
            {GOAL_METRICS.map((metric) => (
              <GoalMetricField key={metric} metric={metric} form={form} disabled={isPending} />
            ))}
          </div>
        </FieldGroup>
        <DialogFooter>
          <DialogClose render={<Button type="button" variant="outline" />}>Cancelar</DialogClose>
          <Button type="submit" disabled={isPending}>
            {isPending ? <Spinner data-icon="inline-start" /> : null}
            Salvar metas
          </Button>
        </DialogFooter>
      </form>
    </>
  )
}

function GoalMetricField({
  metric,
  form,
  disabled,
}: {
  metric: GoalMetric
  form: ReturnType<typeof useForm<GoalFormValues>>
  disabled: boolean
}) {
  const id = `meta-${metric}`
  const amount = isGoalAmountMetric(metric)

  return (
    <Controller
      name={metric}
      control={form.control}
      render={({ field, fieldState }) => (
        <Field data-invalid={fieldState.invalid} data-disabled={disabled || undefined}>
          <FieldLabel htmlFor={id}>{GOAL_METRIC_LABELS[metric]}</FieldLabel>
          {amount ? (
            <InputGroup>
              <InputGroupAddon>
                <InputGroupText>R$</InputGroupText>
              </InputGroupAddon>
              <InputGroupInput
                {...field}
                id={id}
                inputMode="numeric"
                placeholder="Sem meta"
                className="tabular-nums"
                disabled={disabled}
                aria-invalid={fieldState.invalid}
                onChange={(event) => field.onChange(maskBrlInput(event.target.value))}
              />
            </InputGroup>
          ) : (
            <Input
              {...field}
              id={id}
              inputMode="numeric"
              placeholder="Sem meta"
              className="tabular-nums"
              maxLength={6}
              disabled={disabled}
              aria-invalid={fieldState.invalid}
              onChange={(event) => field.onChange(event.target.value.replace(/\D/g, ""))}
            />
          )}
          {fieldState.invalid ? (
            <FieldError errors={[fieldState.error]} />
          ) : (
            <FieldDescription>{GOAL_METRIC_DESCRIPTIONS[metric]}</FieldDescription>
          )}
        </Field>
      )}
    />
  )
}

/** Copia as metas do mês anterior sem sobrescrever as já definidas neste mês. */
export function CopyGoalsButton({
  month,
  previousMonthLabel,
}: {
  month: string
  previousMonthLabel: string
}) {
  const { isPending, run } = useGuardedSubmit()

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      disabled={isPending}
      onClick={() =>
        run(
          async () => {
            const result = await copySalesGoalsFromPreviousMonth(month)

            if (!result.ok) {
              toast.add({
                title: "Não foi possível copiar",
                description: result.error,
                type: "error",
              })
              return
            }

            toast.add({ title: result.message ?? "Metas copiadas.", type: "success" })
          },
          ({ message }) =>
            toast.add({ title: "Não foi possível copiar", description: message, type: "error" })
        )
      }
    >
      {isPending ? <Spinner data-icon="inline-start" /> : <CopyIcon data-icon="inline-start" />}
      Copiar metas de {previousMonthLabel}
    </Button>
  )
}

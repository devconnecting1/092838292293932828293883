"use client"

import * as React from "react"
import { zodResolver } from "@hookform/resolvers/zod"
import { Controller, useForm } from "react-hook-form"

import { nextBusinessDay } from "@workspace/core/email/reminders"
import { Button } from "@workspace/ui/components/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog"
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldTitle,
} from "@workspace/ui/components/field"
import { Spinner } from "@workspace/ui/components/spinner"
import { Switch } from "@workspace/ui/components/switch"
import { Textarea } from "@workspace/ui/components/textarea"
import { toast } from "@workspace/ui/components/toast"
import { ToggleGroup, ToggleGroupItem } from "@workspace/ui/components/toggle-group"

import { DatePicker } from "@/components/agenda/date-picker"
import { updateAppointmentStatus } from "@/lib/agenda/actions"
import { formatDateKey, toDateKey } from "@/lib/agenda/datetime"
import { createVisitFollowUpTask } from "@/lib/agenda/follow-up"
import {
  appointmentFeedbackFormSchema,
  FEEDBACK_MAX_LENGTH,
  type AppointmentFeedbackFormValues,
} from "@/lib/agenda/schemas"

const RATINGS = ["1", "2", "3", "4", "5"] as const

type AppointmentFeedbackDialogProps = {
  appointmentId: string
  /** Resumo exibido no cabeçalho, ex.: "15/09/2026 às 14:30 · IMV-000123 · Título". */
  summary: string
  open: boolean
  onOpenChange: (open: boolean) => void
  defaultRating?: number | null
  defaultFeedback?: string | null
  /**
   * Visita saindo de agendada/confirmada para realizada: oferece criar a tarefa
   * de retorno (já ligada, com o próximo dia útil sugerido).
   */
  offerFollowUp?: boolean
}

/** "Marcar como realizada": nota de 1 a 5 obrigatória e retorno opcional. */
export function AppointmentFeedbackDialog({
  open,
  onOpenChange,
  ...props
}: AppointmentFeedbackDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        {/* Monta a cada abertura: os valores voltam ao padrão. */}
        <AppointmentFeedbackForm {...props} onClose={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  )
}

function AppointmentFeedbackForm({
  appointmentId,
  summary,
  defaultRating,
  defaultFeedback,
  offerFollowUp: offerFollowUpProp = false,
  onClose,
}: Omit<AppointmentFeedbackDialogProps, "open" | "onOpenChange"> & {
  onClose: () => void
}) {
  const [isSaving, startSaving] = React.useTransition()
  // Fixo na abertura: ao salvar, a visita vira "realizada" e a prop muda antes de fechar.
  const [offerFollowUp] = React.useState(offerFollowUpProp)
  const [createFollowUp, setCreateFollowUp] = React.useState(true)
  // Monta a cada abertura (só no navegador): a sugestão é o próximo dia útil.
  const [suggestedDate] = React.useState(() => nextBusinessDay(toDateKey(new Date())))
  const [followUpDate, setFollowUpDate] = React.useState(suggestedDate)
  const [followUpError, setFollowUpError] = React.useState<string | null>(null)
  const wantsFollowUp = offerFollowUp && createFollowUp
  const form = useForm<AppointmentFeedbackFormValues>({
    resolver: zodResolver(appointmentFeedbackFormSchema),
    defaultValues: {
      rating: defaultRating ? String(defaultRating) : "",
      feedback: defaultFeedback ?? "",
    },
  })

  function onSubmit(values: AppointmentFeedbackFormValues) {
    if (wantsFollowUp && !followUpDate) {
      setFollowUpError("Escolha a data do retorno ou desligue a tarefa.")
      return
    }

    startSaving(async () => {
      const result = await updateAppointmentStatus({
        id: appointmentId,
        status: "done",
        rating: Number(values.rating),
        feedback: values.feedback,
      })

      if (!result.ok) {
        toast.add({
          title: "Não foi possível registrar o retorno",
          description: result.error,
          type: "error",
        })
        return
      }

      if (!wantsFollowUp) {
        toast.add({
          title: result.message ?? "Retorno da visita registrado.",
          type: "success",
        })
        onClose()
        return
      }

      const task = await createVisitFollowUpTask({ appointmentId, dueDate: followUpDate })

      toast.add(
        task.ok
          ? {
              title: result.message ?? "Retorno da visita registrado.",
              description: task.message,
              type: "success",
            }
          : {
              title: "Visita registrada, mas a tarefa de retorno não foi criada",
              description: task.error,
              type: "error",
            }
      )
      onClose()
    })
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} noValidate className="flex flex-col gap-4">
      <DialogHeader>
        <DialogTitle>Visita realizada</DialogTitle>
        <DialogDescription>{summary}</DialogDescription>
      </DialogHeader>

      <FieldGroup>
        <Controller
          name="rating"
          control={form.control}
          render={({ field, fieldState }) => (
            <Field data-invalid={fieldState.invalid}>
              <FieldTitle id="appointment-rating-label">Nota do cliente para o imóvel</FieldTitle>
              <ToggleGroup
                aria-labelledby="appointment-rating-label"
                variant="outline"
                spacing={2}
                value={field.value ? [field.value] : []}
                onValueChange={(value) => {
                  field.onChange(value[0] ? String(value[0]) : "")
                  field.onBlur()
                }}
                disabled={isSaving}
              >
                {RATINGS.map((rating) => (
                  <ToggleGroupItem
                    key={rating}
                    value={rating}
                    aria-label={`Nota ${rating}`}
                    aria-invalid={fieldState.invalid || undefined}
                  >
                    {rating}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
              {fieldState.invalid ? (
                <FieldError errors={[fieldState.error]} />
              ) : (
                <FieldDescription>1 = não gostou · 5 = gostou muito.</FieldDescription>
              )}
            </Field>
          )}
        />

        <Controller
          name="feedback"
          control={form.control}
          render={({ field, fieldState }) => (
            <Field data-invalid={fieldState.invalid}>
              <FieldLabel htmlFor="appointment-feedback">Retorno (opcional)</FieldLabel>
              <Textarea
                {...field}
                id="appointment-feedback"
                rows={4}
                maxLength={FEEDBACK_MAX_LENGTH}
                placeholder="O que o cliente achou, objeções e próximos passos."
                aria-invalid={fieldState.invalid}
                disabled={isSaving}
              />
              {fieldState.invalid ? <FieldError errors={[fieldState.error]} /> : null}
            </Field>
          )}
        />

        {offerFollowUp ? (
          <>
            <Field orientation="horizontal">
              <FieldContent>
                <FieldLabel htmlFor="appointment-follow-up">Criar tarefa de retorno</FieldLabel>
                <FieldDescription>
                  Fica com o corretor da visita, ligada ao cliente e ao imóvel.
                </FieldDescription>
              </FieldContent>
              <Switch
                id="appointment-follow-up"
                checked={createFollowUp}
                onCheckedChange={(checked) => {
                  setCreateFollowUp(checked)
                  setFollowUpError(null)
                }}
                disabled={isSaving}
              />
            </Field>
            {createFollowUp ? (
              <Field data-invalid={Boolean(followUpError)}>
                <FieldLabel htmlFor="appointment-follow-up-date">Data do retorno</FieldLabel>
                <DatePicker
                  id="appointment-follow-up-date"
                  value={followUpDate}
                  onChange={(value) => {
                    setFollowUpDate(value)
                    setFollowUpError(null)
                  }}
                  disabled={isSaving}
                  invalid={Boolean(followUpError)}
                />
                {followUpError ? (
                  <FieldError>{followUpError}</FieldError>
                ) : (
                  <FieldDescription>
                    {!followUpDate
                      ? "Escolha quando ligar de volta para o cliente."
                      : followUpDate === suggestedDate
                        ? `Próximo dia útil: ${formatDateKey(followUpDate, "weekday")}.`
                        : `Vence no fim do dia: ${formatDateKey(followUpDate, "weekday")}.`}
                  </FieldDescription>
                )}
              </Field>
            ) : null}
          </>
        ) : null}
      </FieldGroup>

      <DialogFooter>
        <DialogClose render={<Button type="button" variant="outline" />}>Cancelar</DialogClose>
        <Button type="submit" disabled={isSaving}>
          {isSaving ? <Spinner data-icon="inline-start" /> : null}
          Registrar retorno
        </Button>
      </DialogFooter>
    </form>
  )
}

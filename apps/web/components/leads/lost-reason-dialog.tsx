"use client"

import { zodResolver } from "@hookform/resolvers/zod"
import { Controller, useForm, useWatch } from "react-hook-form"

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
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldTitle,
} from "@workspace/ui/components/field"
import { Textarea } from "@workspace/ui/components/textarea"
import { ToggleGroup, ToggleGroupItem } from "@workspace/ui/components/toggle-group"

import { LEAD_LOST_REASON_MAX_LENGTH, LEAD_LOST_REASON_SUGGESTIONS } from "@/lib/leads/constants"
import { lostReasonFormSchema, type LostReasonFormValues } from "@/lib/leads/schemas"

type LostReasonDialogProps = {
  open: boolean
  leadName: string | null
  onConfirm: (reason: string) => void
  onCancel: () => void
}

/** Pede o motivo antes de mover um lead para "Perdido". */
export function LostReasonDialog({ open, leadName, onConfirm, onCancel }: LostReasonDialogProps) {
  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onCancel()
      }}
    >
      <DialogContent className="sm:max-w-md">
        {/* Montado a cada abertura: o formulário recomeça vazio. */}
        <LostReasonForm leadName={leadName} onConfirm={onConfirm} />
      </DialogContent>
    </Dialog>
  )
}

function LostReasonForm({
  leadName,
  onConfirm,
}: Pick<LostReasonDialogProps, "leadName" | "onConfirm">) {
  const form = useForm<LostReasonFormValues>({
    resolver: zodResolver(lostReasonFormSchema),
    defaultValues: { reason: "" },
  })
  const reason = useWatch({ control: form.control, name: "reason" })
  const isSuggestion = (LEAD_LOST_REASON_SUGGESTIONS as readonly string[]).includes(reason)

  return (
    <form
      onSubmit={form.handleSubmit((values) => onConfirm(values.reason.trim()))}
      noValidate
      className="flex flex-col gap-4"
    >
      <DialogHeader>
        <DialogTitle>Marcar lead como perdido</DialogTitle>
        <DialogDescription>
          {leadName ? `${leadName}. ` : ""}
          Registre o motivo para entender onde o funil perde oportunidades.
        </DialogDescription>
      </DialogHeader>

      <FieldGroup>
        <Field>
          <FieldTitle id="lead-perdido-sugestoes">Motivos frequentes</FieldTitle>
          <ToggleGroup
            aria-labelledby="lead-perdido-sugestoes"
            variant="outline"
            size="sm"
            className="flex-wrap"
            value={isSuggestion ? [reason] : []}
            onValueChange={(value: string[]) => {
              const next = value[0]

              if (next) {
                form.setValue("reason", next, {
                  shouldValidate: form.formState.isSubmitted,
                })
              }
            }}
          >
            {LEAD_LOST_REASON_SUGGESTIONS.map((suggestion) => (
              <ToggleGroupItem key={suggestion} value={suggestion}>
                {suggestion}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </Field>

        <Controller
          name="reason"
          control={form.control}
          render={({ field, fieldState }) => (
            <Field data-invalid={fieldState.invalid}>
              <FieldLabel htmlFor="lead-perdido-motivo">Motivo da perda</FieldLabel>
              <Textarea
                {...field}
                id="lead-perdido-motivo"
                rows={3}
                maxLength={LEAD_LOST_REASON_MAX_LENGTH}
                placeholder="Ex.: fechou com outra imobiliária."
                aria-invalid={fieldState.invalid}
              />
              {fieldState.invalid ? <FieldError errors={[fieldState.error]} /> : null}
            </Field>
          )}
        />
      </FieldGroup>

      <DialogFooter>
        <DialogClose render={<Button type="button" variant="outline" />}>Cancelar</DialogClose>
        <Button type="submit" variant="destructive">
          Marcar como perdido
        </Button>
      </DialogFooter>
    </form>
  )
}

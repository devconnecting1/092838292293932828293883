"use client"

import * as React from "react"
import { zodResolver } from "@hookform/resolvers/zod"
import { CircleAlertIcon } from "lucide-react"
import { Controller, useForm, useWatch } from "react-hook-form"

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
} from "@workspace/ui/components/dialog"
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldTitle,
} from "@workspace/ui/components/field"
import { Input } from "@workspace/ui/components/input"
import { Spinner } from "@workspace/ui/components/spinner"
import { Textarea } from "@workspace/ui/components/textarea"
import { toast } from "@workspace/ui/components/toast"
import { ToggleGroup, ToggleGroupItem } from "@workspace/ui/components/toggle-group"

import { OptionCombobox, type ComboboxOption } from "@/components/propostas/option-combobox"
import { checkoutKey } from "@/lib/chaves/actions"
import { toLocalInput } from "@/lib/chaves/datetime"
import { keyCheckoutSchema, type KeyCheckoutValues } from "@/lib/chaves/schemas"

const DEFAULT_LOAN_MS = 3 * 60 * 60 * 1000

type CheckoutFormProps = {
  keyId: string | null
  keyTitle: string
  members: ComboboxOption[]
  clients: ComboboxOption[]
  currentUserId: string
}

type KeyCheckoutDialogProps = CheckoutFormProps & {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function KeyCheckoutDialog({ open, onOpenChange, ...formProps }: KeyCheckoutDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        {/* O conteúdo monta a cada abertura: prazo padrão calculado na hora. */}
        <CheckoutForm
          key={formProps.keyId ?? "sem-chave"}
          {...formProps}
          onDone={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  )
}

function getInitialTimes() {
  const now = new Date()

  return {
    min: toLocalInput(now),
    due: toLocalInput(new Date(now.getTime() + DEFAULT_LOAN_MS)),
  }
}

function CheckoutForm({
  keyId,
  keyTitle,
  members,
  clients,
  currentUserId,
  onDone,
}: CheckoutFormProps & { onDone: () => void }) {
  const [isSubmitting, startSubmit] = React.useTransition()
  const [formError, setFormError] = React.useState<string | null>(null)
  const [times] = React.useState(getInitialTimes)

  const form = useForm<KeyCheckoutValues>({
    resolver: zodResolver(keyCheckoutSchema),
    mode: "onTouched",
    defaultValues: {
      takerKind: "member",
      memberId: members.some((member) => member.value === currentUserId) ? currentUserId : "",
      clientId: "",
      dueAt: times.due,
      notes: "",
    },
  })

  const takerKind = useWatch({ control: form.control, name: "takerKind" })

  function onSubmit(values: KeyCheckoutValues) {
    if (!keyId) return

    setFormError(null)

    startSubmit(async () => {
      const result = await checkoutKey(keyId, values)

      if (!result.ok) {
        setFormError(result.error)
        return
      }

      toast.add({
        title: result.message ?? "Retirada registrada.",
        type: "success",
      })
      onDone()
    })
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Registrar retirada</DialogTitle>
        <DialogDescription>{keyTitle}</DialogDescription>
      </DialogHeader>
      <form onSubmit={form.handleSubmit(onSubmit)} noValidate className="flex flex-col gap-6">
        <FieldGroup>
          {formError ? (
            <Alert variant="destructive">
              <CircleAlertIcon />
              <AlertTitle>Não foi possível registrar</AlertTitle>
              <AlertDescription>{formError}</AlertDescription>
            </Alert>
          ) : null}
          <Controller
            name="takerKind"
            control={form.control}
            render={({ field }) => (
              <Field>
                <FieldTitle id="chave-quem-retira">Quem está retirando</FieldTitle>
                <ToggleGroup
                  aria-labelledby="chave-quem-retira"
                  variant="outline"
                  value={[field.value]}
                  onValueChange={(value) => {
                    const next = value[0]
                    if (next === "member" || next === "client") field.onChange(next)
                  }}
                >
                  <ToggleGroupItem value="member">Membro da equipe</ToggleGroupItem>
                  <ToggleGroupItem value="client">Cliente</ToggleGroupItem>
                </ToggleGroup>
              </Field>
            )}
          />
          {takerKind === "member" ? (
            <Controller
              name="memberId"
              control={form.control}
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid}>
                  <FieldLabel htmlFor="chave-membro">Membro da equipe</FieldLabel>
                  <OptionCombobox
                    id="chave-membro"
                    options={members}
                    value={field.value}
                    onValueChange={field.onChange}
                    onBlur={field.onBlur}
                    placeholder="Buscar pelo nome"
                    emptyText="Nenhum membro encontrado."
                    invalid={fieldState.invalid}
                  />
                  {fieldState.invalid ? <FieldError errors={[fieldState.error]} /> : null}
                </Field>
              )}
            />
          ) : (
            <Controller
              name="clientId"
              control={form.control}
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid}>
                  <FieldLabel htmlFor="chave-cliente">Cliente</FieldLabel>
                  <OptionCombobox
                    id="chave-cliente"
                    options={clients}
                    value={field.value}
                    onValueChange={field.onChange}
                    onBlur={field.onBlur}
                    placeholder="Buscar pelo nome"
                    emptyText="Nenhum cliente encontrado."
                    invalid={fieldState.invalid}
                  />
                  {fieldState.invalid ? (
                    <FieldError errors={[fieldState.error]} />
                  ) : (
                    <FieldDescription>
                      Só aparecem os clientes a que você tem acesso.
                    </FieldDescription>
                  )}
                </Field>
              )}
            />
          )}
          <Controller
            name="dueAt"
            control={form.control}
            render={({ field, fieldState }) => (
              <Field data-invalid={fieldState.invalid}>
                <FieldLabel htmlFor="chave-devolucao">Devolução prevista</FieldLabel>
                <Input
                  {...field}
                  id="chave-devolucao"
                  type="datetime-local"
                  min={times.min}
                  aria-invalid={fieldState.invalid}
                />
                {fieldState.invalid ? (
                  <FieldError errors={[fieldState.error]} />
                ) : (
                  <FieldDescription>Horário de Brasília.</FieldDescription>
                )}
              </Field>
            )}
          />
          <Controller
            name="notes"
            control={form.control}
            render={({ field, fieldState }) => (
              <Field data-invalid={fieldState.invalid}>
                <FieldLabel htmlFor="chave-retirada-obs">Observação (opcional)</FieldLabel>
                <Textarea
                  {...field}
                  id="chave-retirada-obs"
                  rows={3}
                  maxLength={2000}
                  placeholder="Ex.: visita com o cliente às 15h"
                  aria-invalid={fieldState.invalid}
                />
                {fieldState.invalid ? <FieldError errors={[fieldState.error]} /> : null}
              </Field>
            )}
          />
        </FieldGroup>
        <DialogFooter>
          <DialogClose render={<Button type="button" variant="outline" />}>Cancelar</DialogClose>
          <Button type="submit" disabled={isSubmitting || !keyId}>
            {isSubmitting ? <Spinner data-icon="inline-start" /> : null}
            Registrar retirada
          </Button>
        </DialogFooter>
      </form>
    </>
  )
}

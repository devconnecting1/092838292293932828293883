"use client"

import * as React from "react"
import { zodResolver } from "@hookform/resolvers/zod"
import { CircleAlertIcon, InfoIcon } from "lucide-react"
import { Controller, useForm, useWatch } from "react-hook-form"

import { Alert, AlertDescription, AlertTitle } from "@workspace/ui/components/alert"
import { Button } from "@workspace/ui/components/button"
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldSeparator,
} from "@workspace/ui/components/field"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select"
import { Spinner } from "@workspace/ui/components/spinner"
import { Switch } from "@workspace/ui/components/switch"
import { toast } from "@workspace/ui/components/toast"

import { PercentField } from "@/components/comissoes/commission-fields"
import { ROLE_LABELS } from "@/lib/auth/roles"
import type { MemberOption } from "@/lib/clientes/options"
import { saveCommissionSettings } from "@/lib/comissoes/actions"
import { commissionSettingsSchema, type CommissionSettingsValues } from "@/lib/comissoes/schemas"

const NO_MANAGER = "__sem_gerente__"

export function CommissionSettingsForm({
  defaultValues,
  members,
}: {
  defaultValues: CommissionSettingsValues
  members: readonly MemberOption[]
}) {
  const [isPending, startTransition] = React.useTransition()
  const [formError, setFormError] = React.useState<string | null>(null)

  const form = useForm<CommissionSettingsValues>({
    resolver: zodResolver(commissionSettingsSchema),
    mode: "onTouched",
    defaultValues,
  })

  const discountEnabled = useWatch({ control: form.control, name: "discountApprovalEnabled" })

  const managerItems = [
    { value: NO_MANAGER, label: "Sem gerente · a fatia fica com a imobiliária" },
    ...members.map((member) => ({
      value: member.id,
      label: `${member.name} · ${ROLE_LABELS[member.role]}`,
    })),
  ]

  function onSubmit(values: CommissionSettingsValues) {
    setFormError(null)

    startTransition(async () => {
      const result = await saveCommissionSettings(values)

      if (result.ok) {
        toast.add({ title: result.message ?? "Ajustes salvos.", type: "success" })
        form.reset(values)
        return
      }

      for (const [field, message] of Object.entries(result.fieldErrors ?? {})) {
        if (message) {
          form.setError(field as keyof CommissionSettingsValues, { type: "server", message })
        }
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
          control={form.control}
          name="managerUserId"
          render={({ field }) => (
            <Field>
              <FieldLabel htmlFor="comissao-gerente">
                Gerente que recebe a fatia de gerência
              </FieldLabel>
              <Select
                items={managerItems}
                value={field.value || NO_MANAGER}
                onValueChange={(value) => field.onChange(value === NO_MANAGER ? "" : (value ?? ""))}
                onOpenChange={(open) => {
                  if (!open) field.onBlur()
                }}
              >
                <SelectTrigger id="comissao-gerente" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {managerItems.map((item) => (
                      <SelectItem key={item.value} value={item.value}>
                        {item.label}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
              <FieldDescription>
                Vale para os negócios fechados daqui para a frente. Os antigos guardam o que foi
                calculado no dia.
              </FieldDescription>
            </Field>
          )}
        />

        <FieldSeparator />

        <Controller
          control={form.control}
          name="discountApprovalEnabled"
          render={({ field }) => (
            <Field orientation="horizontal">
              <FieldContent>
                <FieldLabel htmlFor="comissao-desconto">
                  Exigir aprovação para desconto grande
                </FieldLabel>
                <FieldDescription>
                  Com isto ligado, proposta abaixo do limite só é enviada ou aceita depois que o
                  gerente aprovar. Quem tenta antes recebe o aviso na hora.
                </FieldDescription>
              </FieldContent>
              <Switch
                id="comissao-desconto"
                checked={field.value}
                onCheckedChange={field.onChange}
              />
            </Field>
          )}
        />

        {discountEnabled ? (
          <>
            <PercentField
              control={form.control}
              name="maxDiscountPercent"
              id="comissao-desconto-limite"
              label="Desconto que o corretor dá sozinho"
              description="Medido sobre o preço anunciado do imóvel (venda ou aluguel). Acima disso, precisa de aprovação."
            />

            <Alert>
              <InfoIcon />
              <AlertTitle>Imóvel sem preço anunciado não trava</AlertTitle>
              <AlertDescription>
                Sem valor de venda ou de aluguel cadastrado não há como medir desconto, então a
                proposta segue normalmente.
              </AlertDescription>
            </Alert>
          </>
        ) : null}

        <Field orientation="horizontal" className="justify-end">
          <Button type="submit" disabled={isPending || !form.formState.isDirty}>
            {isPending ? <Spinner data-icon="inline-start" /> : null}
            Salvar ajustes
          </Button>
        </Field>
      </FieldGroup>
    </form>
  )
}

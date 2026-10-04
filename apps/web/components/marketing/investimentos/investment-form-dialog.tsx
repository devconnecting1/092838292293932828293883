"use client"

import * as React from "react"
import { zodResolver } from "@hookform/resolvers/zod"
import { CircleAlertIcon, PencilIcon, PlusIcon } from "lucide-react"
import { Controller, useForm, useWatch } from "react-hook-form"

import {
  formatMonthLabel,
  MARKETING_CAMPAIGN_MAX_LENGTH,
  MARKETING_NOTES_MAX_LENGTH,
} from "@workspace/core/reports/marketing-investments"
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
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select"
import { Spinner } from "@workspace/ui/components/spinner"
import { Textarea } from "@workspace/ui/components/textarea"
import { toast } from "@workspace/ui/components/toast"

import { MoneyField } from "@/components/comissoes/commission-fields"
import { LEAD_SOURCE_LABELS, LEAD_SOURCES } from "@/lib/leads/constants"
import type { LeadSource } from "@/lib/leads/db-types"
import { saveMarketingInvestment } from "@/lib/marketing/investimentos/actions"
import { investmentSchema, type InvestmentValues } from "@/lib/marketing/investimentos/schemas"

export type CampaignSuggestionOption = { source: LeadSource; campaign: string; leads: number }

type Props = {
  monthOptions: readonly string[]
  campaignSuggestions: readonly CampaignSuggestionOption[]
} & (
  | { mode: "create"; defaultMonth: string }
  | { mode: "edit"; investment: Omit<InvestmentValues, "id"> & { id: string } }
)

const SOURCE_ITEMS = LEAD_SOURCES.map((source) => ({
  value: source,
  label: LEAD_SOURCE_LABELS[source],
}))

export function InvestmentFormDialog(props: Props) {
  const isCreate = props.mode === "create"
  const [open, setOpen] = React.useState(false)
  const [isPending, startTransition] = React.useTransition()
  const [formError, setFormError] = React.useState<string | null>(null)
  const prefix = isCreate ? "investimento-novo" : `investimento-${props.investment.id}`

  const defaults: InvestmentValues = isCreate
    ? { id: "", month: props.defaultMonth, source: "social", campaign: "", amount: "", notes: "" }
    : props.investment

  const form = useForm<InvestmentValues>({
    resolver: zodResolver(investmentSchema),
    mode: "onTouched",
    defaultValues: defaults,
  })

  const source = useWatch({ control: form.control, name: "source" })
  const suggestions = props.campaignSuggestions.filter((item) => item.source === source)

  const monthItems = (
    props.monthOptions.includes(defaults.month)
      ? props.monthOptions
      : [defaults.month, ...props.monthOptions]
  ).map((month) => ({ value: month, label: formatMonthLabel(month) }))

  function onSubmit(values: InvestmentValues) {
    setFormError(null)

    startTransition(async () => {
      const result = await saveMarketingInvestment(values)

      if (result.ok) {
        toast.add({ title: result.message ?? "Investimento salvo.", type: "success" })
        setOpen(false)
        return
      }

      for (const [field, message] of Object.entries(result.fieldErrors ?? {})) {
        if (message) {
          form.setError(field as keyof InvestmentValues, { type: "server", message })
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
      {isCreate ? (
        <DialogTrigger render={<Button />}>
          <PlusIcon data-icon="inline-start" />
          Lançar investimento
        </DialogTrigger>
      ) : (
        <DialogTrigger render={<Button variant="ghost" size="icon-sm" />}>
          <PencilIcon />
          <span className="sr-only">Editar lançamento</span>
        </DialogTrigger>
      )}
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{isCreate ? "Lançar investimento" : "Editar investimento"}</DialogTitle>
          <DialogDescription>
            Quanto foi gasto no mês num canal. Informe a campanha quando quiser o custo por lead
            dela separado do resto do canal.
          </DialogDescription>
        </DialogHeader>

        <form id={`${prefix}-form`} onSubmit={form.handleSubmit(onSubmit)} noValidate>
          <FieldGroup>
            {formError ? (
              <Alert variant="destructive">
                <CircleAlertIcon />
                <AlertTitle>Não foi possível salvar</AlertTitle>
                <AlertDescription>{formError}</AlertDescription>
              </Alert>
            ) : null}

            <div className="grid gap-5 sm:grid-cols-2">
              <Controller
                control={form.control}
                name="month"
                render={({ field, fieldState }) => (
                  <Field data-invalid={fieldState.invalid}>
                    <FieldLabel htmlFor={`${prefix}-mes`}>Mês</FieldLabel>
                    <Select
                      items={monthItems}
                      value={field.value}
                      onValueChange={(value) => field.onChange(value ?? "")}
                      onOpenChange={(nextOpen) => {
                        if (!nextOpen) field.onBlur()
                      }}
                    >
                      <SelectTrigger id={`${prefix}-mes`} className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          {monthItems.map((item) => (
                            <SelectItem key={item.value} value={item.value}>
                              {item.label}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                    {fieldState.invalid ? <FieldError errors={[fieldState.error]} /> : null}
                  </Field>
                )}
              />

              <Controller
                control={form.control}
                name="source"
                render={({ field, fieldState }) => (
                  <Field data-invalid={fieldState.invalid}>
                    <FieldLabel htmlFor={`${prefix}-canal`}>Canal (origem do lead)</FieldLabel>
                    <Select
                      items={SOURCE_ITEMS}
                      value={field.value}
                      onValueChange={(value) => field.onChange(value ?? "")}
                      onOpenChange={(nextOpen) => {
                        if (!nextOpen) field.onBlur()
                      }}
                    >
                      <SelectTrigger id={`${prefix}-canal`} className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          {SOURCE_ITEMS.map((item) => (
                            <SelectItem key={item.value} value={item.value}>
                              {item.label}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                    {fieldState.invalid ? <FieldError errors={[fieldState.error]} /> : null}
                  </Field>
                )}
              />
            </div>

            <Field data-invalid={Boolean(form.formState.errors.campaign)}>
              <FieldLabel htmlFor={`${prefix}-campanha`}>Campanha (opcional)</FieldLabel>
              <Input
                id={`${prefix}-campanha`}
                list={suggestions.length > 0 ? `${prefix}-campanhas` : undefined}
                maxLength={MARKETING_CAMPAIGN_MAX_LENGTH}
                autoComplete="off"
                placeholder="Ex.: lancamento-setembro"
                aria-invalid={Boolean(form.formState.errors.campaign)}
                {...form.register("campaign")}
              />
              {suggestions.length > 0 ? (
                <datalist id={`${prefix}-campanhas`}>
                  {suggestions.map((item) => (
                    <option
                      key={item.campaign}
                      value={item.campaign}
                      label={`${item.leads} ${item.leads === 1 ? "lead" : "leads"} nos últimos 180 dias`}
                    />
                  ))}
                </datalist>
              ) : null}
              {form.formState.errors.campaign ? (
                <FieldError errors={[form.formState.errors.campaign]} />
              ) : (
                <FieldDescription>
                  Escreva igual ao utm_campaign do anúncio (maiúsculas não importam). Em branco, o
                  valor cobre os leads do canal sem campanha lançada.
                </FieldDescription>
              )}
            </Field>

            <MoneyField
              control={form.control}
              name="amount"
              id={`${prefix}-valor`}
              label="Valor investido no mês"
              description="Total pago no mês inteiro, mesmo que o anúncio tenha rodado só alguns dias."
            />

            <Field data-invalid={Boolean(form.formState.errors.notes)}>
              <FieldLabel htmlFor={`${prefix}-obs`}>Observação (opcional)</FieldLabel>
              <Textarea
                id={`${prefix}-obs`}
                rows={2}
                maxLength={MARKETING_NOTES_MAX_LENGTH}
                placeholder="Ex.: nota fiscal 123, impulsionamento Instagram"
                aria-invalid={Boolean(form.formState.errors.notes)}
                {...form.register("notes")}
              />
              {form.formState.errors.notes ? (
                <FieldError errors={[form.formState.errors.notes]} />
              ) : null}
            </Field>

            {isCreate ? (
              <FieldDescription>
                Se já existir lançamento para o mesmo mês, canal e campanha, o valor é substituído
                (não soma).
              </FieldDescription>
            ) : null}
          </FieldGroup>
        </form>

        <DialogFooter>
          <DialogClose render={<Button variant="outline" />} disabled={isPending}>
            Cancelar
          </DialogClose>
          <Button type="submit" form={`${prefix}-form`} disabled={isPending}>
            {isPending ? <Spinner data-icon="inline-start" /> : null}
            {isCreate ? "Lançar" : "Salvar alterações"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

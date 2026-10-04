"use client"

import * as React from "react"
import { zodResolver } from "@hookform/resolvers/zod"
import { CircleAlertIcon, InfoIcon } from "lucide-react"
import { Controller, useForm, useWatch, type Control } from "react-hook-form"

import { Alert, AlertDescription, AlertTitle } from "@workspace/ui/components/alert"
import { Button } from "@workspace/ui/components/button"
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSeparator,
  FieldSet,
} from "@workspace/ui/components/field"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
} from "@workspace/ui/components/input-group"
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

import { saveLeadRoutingSettings } from "@/app/(app)/configuracoes/rodizio/actions"
import {
  LEAD_ROUTING_TIME_ZONE_OPTIONS,
  leadRoutingSettingsSchema,
  timeZoneLabel,
  type LeadRoutingSettingsValues,
} from "@/lib/leads/routing"

type SwitchFieldProps = {
  control: Control<LeadRoutingSettingsValues>
  name: "rouletteEnabled" | "respectSchedule" | "fallbackToPageAssignee" | "slaReassignEnabled"
  id: string
  label: string
  description: React.ReactNode
}

function SwitchField({ control, name, id, label, description }: SwitchFieldProps) {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field }) => (
        <Field orientation="horizontal">
          <FieldContent>
            <FieldLabel htmlFor={id}>{label}</FieldLabel>
            <FieldDescription>{description}</FieldDescription>
          </FieldContent>
          <Switch id={id} checked={field.value} onCheckedChange={field.onChange} />
        </Field>
      )}
    />
  )
}

type NumberFieldProps = {
  control: Control<LeadRoutingSettingsValues>
  name: "slaMinutes" | "slaWarningPercent" | "maxReassignments"
  id: string
  label: string
  description: React.ReactNode
  min: number
  max: number
  /** Texto colado ao campo (ex.: "minutos", "%"). */
  unit: string
}

function NumberField({ control, name, id, label, description, min, max, unit }: NumberFieldProps) {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => (
        <Field data-invalid={fieldState.invalid}>
          <FieldLabel htmlFor={id}>{label}</FieldLabel>
          <InputGroup>
            <InputGroupInput
              id={id}
              name={field.name}
              ref={field.ref}
              type="number"
              inputMode="numeric"
              min={min}
              max={max}
              step={1}
              value={Number.isFinite(field.value) ? String(field.value) : ""}
              onBlur={field.onBlur}
              onChange={(event) =>
                field.onChange(event.target.value === "" ? Number.NaN : event.target.valueAsNumber)
              }
              aria-invalid={fieldState.invalid}
            />
            <InputGroupAddon align="inline-end">
              <InputGroupText>{unit}</InputGroupText>
            </InputGroupAddon>
          </InputGroup>
          {fieldState.invalid ? (
            <FieldError errors={[fieldState.error]} />
          ) : (
            <FieldDescription>{description}</FieldDescription>
          )}
        </Field>
      )}
    />
  )
}

export function LeadRoutingSettingsForm({
  defaultValues,
}: {
  defaultValues: LeadRoutingSettingsValues
}) {
  const [isPending, startTransition] = React.useTransition()
  const [formError, setFormError] = React.useState<string | null>(null)

  const form = useForm<LeadRoutingSettingsValues>({
    resolver: zodResolver(leadRoutingSettingsSchema),
    mode: "onTouched",
    defaultValues,
  })

  const rouletteEnabled = useWatch({ control: form.control, name: "rouletteEnabled" })
  const slaReassignEnabled = useWatch({ control: form.control, name: "slaReassignEnabled" })
  const slaMinutes = useWatch({ control: form.control, name: "slaMinutes" })
  const slaWarningPercent = useWatch({ control: form.control, name: "slaWarningPercent" })
  const timeZone = useWatch({ control: form.control, name: "timeZone" })

  // Fuso já salvo que não está na lista (ex.: cadastrado por outra ferramenta).
  const timeZoneItems = React.useMemo(() => {
    const options = LEAD_ROUTING_TIME_ZONE_OPTIONS.map((option) => ({
      value: option.value,
      label: option.label,
    }))

    return options.some((option) => option.value === timeZone) || !timeZone
      ? options
      : [{ value: timeZone, label: timeZoneLabel(timeZone) }, ...options]
  }, [timeZone])

  const warningMinutes =
    Number.isFinite(slaMinutes) && Number.isFinite(slaWarningPercent)
      ? Math.max(1, Math.floor((slaMinutes * slaWarningPercent) / 100))
      : null

  function onSubmit(values: LeadRoutingSettingsValues) {
    setFormError(null)

    startTransition(async () => {
      const result = await saveLeadRoutingSettings(values)

      if (result.ok) {
        toast.add({ title: result.message ?? "Configuração salva.", type: "success" })
        form.reset(values)
        return
      }

      for (const [field, message] of Object.entries(result.fieldErrors ?? {})) {
        if (message) {
          form.setError(field as keyof LeadRoutingSettingsValues, {
            type: "server",
            message,
          })
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

        <Alert>
          <InfoIcon />
          <AlertTitle>
            {rouletteEnabled
              ? "O rodízio está ligado: o CRM escolhe o corretor de cada lead novo"
              : "O rodízio está desligado: vale a regra de sempre"}
          </AlertTitle>
          <AlertDescription>
            {rouletteEnabled
              ? "Cada lead que chega vai para o próximo corretor da fila — quem recebeu menos leads hoje, considerando o peso de cada um. Se ninguém puder atender na hora, o lead espera a próxima janela de plantão."
              : "O lead fica com o responsável fixo da página de captação e, quando não houver responsável, entra sem dono para qualquer corretor assumir. Ligue o rodízio abaixo para o CRM distribuir sozinho."}
          </AlertDescription>
        </Alert>

        <FieldSet>
          <FieldLegend>Distribuição</FieldLegend>
          <FieldDescription>Quem recebe cada lead novo e em que horários.</FieldDescription>

          <SwitchField
            control={form.control}
            name="rouletteEnabled"
            id="rodizio-ligado"
            label="Distribuir os leads automaticamente"
            description="O CRM entrega cada lead novo ao próximo corretor da fila do rodízio, sem ninguém precisar escolher."
          />

          <SwitchField
            control={form.control}
            name="respectSchedule"
            id="rodizio-escala"
            label="Respeitar a escala de plantão"
            description="Fora das janelas cadastradas, o corretor não recebe leads. Quem não tem nenhuma janela cadastrada atende sempre."
          />

          <SwitchField
            control={form.control}
            name="fallbackToPageAssignee"
            id="rodizio-fallback"
            label="Usar o responsável fixo da página quando ninguém puder atender"
            description="Com a fila vazia ou todo mundo fora do plantão, o lead vai para o corretor marcado na página de captação, em vez de ficar esperando."
          />

          <Controller
            control={form.control}
            name="timeZone"
            render={({ field, fieldState }) => (
              <Field data-invalid={fieldState.invalid}>
                <FieldLabel htmlFor="rodizio-fuso">Fuso horário da imobiliária</FieldLabel>
                <Select
                  items={timeZoneItems}
                  value={field.value}
                  onValueChange={(value) => {
                    if (value) field.onChange(value)
                  }}
                  onOpenChange={(open) => {
                    if (!open) field.onBlur()
                  }}
                >
                  <SelectTrigger
                    id="rodizio-fuso"
                    className="w-full"
                    aria-invalid={fieldState.invalid}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {timeZoneItems.map((item) => (
                        <SelectItem key={item.value} value={item.value}>
                          {item.label}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
                {fieldState.invalid ? (
                  <FieldError errors={[fieldState.error]} />
                ) : (
                  <FieldDescription>
                    Serve para o horário do plantão e para contar os leads do dia de cada corretor.
                  </FieldDescription>
                )}
              </Field>
            )}
          />
        </FieldSet>

        <FieldSeparator />

        <FieldSet>
          <FieldLegend>Prazo do primeiro contato</FieldLegend>
          <FieldDescription>
            O relógio começa quando o lead ganha um responsável e só para quando o corretor registra
            o primeiro contato.
          </FieldDescription>

          <div className="grid gap-5 sm:grid-cols-2">
            <NumberField
              control={form.control}
              name="slaMinutes"
              id="rodizio-sla"
              label="Tempo para o primeiro contato"
              min={1}
              max={1440}
              unit="minutos"
              description="Responder nos primeiros minutos é o que mais aumenta a chance de fechar. De 1 minuto a 24 horas."
            />

            <NumberField
              control={form.control}
              name="slaWarningPercent"
              id="rodizio-aviso"
              label="Avisar quando o prazo chegar a"
              min={10}
              max={95}
              unit="% do prazo"
              description={
                warningMinutes
                  ? `O corretor é avisado ${warningMinutes} ${
                      warningMinutes === 1 ? "minuto" : "minutos"
                    } depois de receber o lead.`
                  : "Percentual do prazo já gasto que dispara o aviso."
              }
            />
          </div>

          <SwitchField
            control={form.control}
            name="slaReassignEnabled"
            id="rodizio-redistribui"
            label="Passar o lead para outro corretor quando o prazo estourar"
            description="Se ninguém falar com o lead dentro do prazo, ele volta para a fila e vai para o próximo corretor disponível."
          />

          {slaReassignEnabled ? (
            <NumberField
              control={form.control}
              name="maxReassignments"
              id="rodizio-max-redistribuicoes"
              label="Quantas vezes o mesmo lead pode trocar de corretor"
              min={0}
              max={10}
              unit="vezes"
              description="Depois disso o lead para de girar e fica com o último responsável, para não rodar a equipe inteira."
            />
          ) : null}
        </FieldSet>

        <Field orientation="horizontal" className="justify-end">
          <Button type="submit" disabled={isPending || !form.formState.isDirty}>
            {isPending ? <Spinner data-icon="inline-start" /> : null}
            Salvar configuração
          </Button>
        </Field>
      </FieldGroup>
    </form>
  )
}

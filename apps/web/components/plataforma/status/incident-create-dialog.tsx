"use client"

import * as React from "react"
import { zodResolver } from "@hookform/resolvers/zod"
import { CircleAlertIcon, PlusIcon } from "lucide-react"
import { Controller, useForm, useWatch } from "react-hook-form"

import { toBrasiliaInputValue } from "@workspace/core/platform/announcements"
import {
  INCIDENT_KIND_LABELS,
  INCIDENT_KINDS,
  INCIDENT_LIMITS,
  incidentCreateFormSchema,
  type IncidentCreateFormValues,
  type IncidentKind,
} from "@workspace/core/status/incidents"
import { INCIDENT_STATUS_LABELS, type IncidentStatus } from "@workspace/core/status/public"
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
  FieldContent,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
  FieldTitle,
} from "@workspace/ui/components/field"
import { RadioGroup, RadioGroupItem } from "@workspace/ui/components/radio-group"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select"
import { Spinner } from "@workspace/ui/components/spinner"
import { toast } from "@workspace/ui/components/toast"

import { createIncidentAction } from "@/app/plataforma/status/actions"
import { PLATFORM_READ_ONLY_NOTICE_ID } from "@/components/plataforma/equipe/read-only-notice"
import {
  IncidentComponentsField,
  IncidentImpactField,
  IncidentMessageField,
  IncidentTitleField,
  MaintenanceDateField,
} from "@/components/plataforma/status/incident-fields"

const KIND_HINTS: Record<IncidentKind, string> = {
  incident:
    "Algo parou ou está lento agora. Fica “em aberto” na página até alguém publicar “Resolvido”.",
  maintenance:
    "Parada programada. Aparece como agendada, começa e termina sozinha pelo horário se ninguém mexer.",
}

const INITIAL_STATUSES = ["investigating", "identified", "monitoring"] as const

const INITIAL_STATUS_HINTS: Partial<Record<IncidentStatus, string>> = {
  investigating: "Ainda procurando a causa.",
  identified: "Causa encontrada, correção em andamento.",
  monitoring: "Correção aplicada, acompanhando se voltou ao normal.",
}

const INITIAL_STATUS_ITEMS = INITIAL_STATUSES.map((status) => ({
  value: status,
  label: INCIDENT_STATUS_LABELS[status],
}))

const HOUR_MS = 60 * 60 * 1000

function newIncidentValues(): IncidentCreateFormValues {
  const start = new Date(Date.now() + HOUR_MS)

  return {
    kind: "incident",
    title: "",
    impact: "minor",
    componentKeys: [],
    status: "investigating",
    message: "",
    scheduledFor: toBrasiliaInputValue(start),
    scheduledUntil: toBrasiliaInputValue(new Date(start.getTime() + 2 * HOUR_MS)),
  }
}

/** Botão "Novo incidente ou manutenção" com o formulário no diálogo. */
export function IncidentCreateDialog({
  variant = "default",
  readOnly = false,
}: {
  variant?: "default" | "outline"
  /** Somente leitura: botão desabilitado (o servidor recusa de qualquer jeito). */
  readOnly?: boolean
}) {
  const [open, setOpen] = React.useState(false)

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button
            variant={variant}
            disabled={readOnly}
            aria-describedby={readOnly ? PLATFORM_READ_ONLY_NOTICE_ID : undefined}
          />
        }
      >
        <PlusIcon data-icon="inline-start" />
        Novo incidente ou manutenção
      </DialogTrigger>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg">
        {/* Monta a cada abertura: horários padrão calculados na hora. */}
        {open ? <IncidentCreateForm onDone={() => setOpen(false)} /> : null}
      </DialogContent>
    </Dialog>
  )
}

function IncidentCreateForm({ onDone }: { onDone: () => void }) {
  const [isSubmitting, startSubmit] = React.useTransition()
  const [formError, setFormError] = React.useState<string | null>(null)
  const [defaultValues] = React.useState(newIncidentValues)

  const form = useForm<IncidentCreateFormValues>({
    resolver: zodResolver(incidentCreateFormSchema),
    mode: "onTouched",
    defaultValues,
  })

  const kind = useWatch({ control: form.control, name: "kind" })

  function onSubmit(values: IncidentCreateFormValues) {
    setFormError(null)

    startSubmit(async () => {
      const result = await createIncidentAction(values)

      if (result.ok) {
        toast.add({ title: result.message, type: "success" })
        onDone()
        return
      }

      for (const [field, message] of Object.entries(result.fieldErrors ?? {})) {
        if (message) {
          form.setError(field as keyof IncidentCreateFormValues, { type: "server", message })
        }
      }

      setFormError(result.error)
    })
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Novo incidente ou manutenção</DialogTitle>
        <DialogDescription>
          Isto aparece na página pública /status e na faixa do CRM. Escreva para o cliente: o que
          acontece e o que muda para ele, sem detalhe interno.
        </DialogDescription>
      </DialogHeader>
      <form onSubmit={form.handleSubmit(onSubmit)} noValidate className="flex flex-col gap-6">
        <FieldGroup>
          {formError ? (
            <Alert variant="destructive">
              <CircleAlertIcon />
              <AlertTitle>Não foi possível publicar</AlertTitle>
              <AlertDescription>{formError}</AlertDescription>
            </Alert>
          ) : null}

          <Controller
            name="kind"
            control={form.control}
            render={({ field, fieldState }) => (
              <FieldSet data-invalid={fieldState.invalid}>
                <FieldLegend variant="label">Tipo</FieldLegend>
                <RadioGroup value={field.value} onValueChange={(value) => field.onChange(value)}>
                  {INCIDENT_KINDS.map((option) => (
                    <FieldLabel key={option} htmlFor={`novo-incidente-tipo-${option}`}>
                      <Field orientation="horizontal">
                        <FieldContent>
                          <FieldTitle>{INCIDENT_KIND_LABELS[option]}</FieldTitle>
                          <FieldDescription>{KIND_HINTS[option]}</FieldDescription>
                        </FieldContent>
                        <RadioGroupItem value={option} id={`novo-incidente-tipo-${option}`} />
                      </Field>
                    </FieldLabel>
                  ))}
                </RadioGroup>
                {fieldState.invalid ? <FieldError errors={[fieldState.error]} /> : null}
              </FieldSet>
            )}
          />

          <Controller
            name="title"
            control={form.control}
            render={({ field, fieldState }) => (
              <IncidentTitleField
                id="novo-incidente-titulo"
                value={field.value}
                onChange={field.onChange}
                onBlur={field.onBlur}
                invalid={fieldState.invalid}
                error={fieldState.error}
                placeholder={
                  kind === "maintenance"
                    ? "Ex.: Manutenção programada no banco de dados"
                    : "Ex.: Lentidão para abrir a lista de leads"
                }
              />
            )}
          />

          <Controller
            name="impact"
            control={form.control}
            render={({ field, fieldState }) => (
              <IncidentImpactField
                id="novo-incidente-impacto"
                kind={kind}
                value={field.value}
                onChange={field.onChange}
                onBlur={field.onBlur}
                invalid={fieldState.invalid}
                error={fieldState.error}
              />
            )}
          />

          <Controller
            name="componentKeys"
            control={form.control}
            render={({ field, fieldState }) => (
              <IncidentComponentsField
                id="novo-incidente-partes"
                description="Marque só o que o cliente sente. As demais partes seguem a medição automática."
                value={field.value}
                onChange={field.onChange}
                onBlur={field.onBlur}
                invalid={fieldState.invalid}
                error={fieldState.error}
              />
            )}
          />

          {kind === "incident" ? (
            <Controller
              name="status"
              control={form.control}
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid}>
                  <FieldLabel htmlFor="novo-incidente-estado">Estado inicial</FieldLabel>
                  <Select
                    items={INITIAL_STATUS_ITEMS}
                    value={field.value}
                    onValueChange={(value) => {
                      if (value) field.onChange(value)
                    }}
                    onOpenChange={(isOpen) => {
                      if (!isOpen) field.onBlur()
                    }}
                  >
                    <SelectTrigger
                      id="novo-incidente-estado"
                      className="w-full"
                      aria-invalid={fieldState.invalid}
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        {INITIAL_STATUS_ITEMS.map((item) => (
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
                    <FieldDescription>{INITIAL_STATUS_HINTS[field.value]}</FieldDescription>
                  )}
                </Field>
              )}
            />
          ) : (
            <FieldSet>
              <FieldLegend variant="label">Janela da manutenção</FieldLegend>
              <FieldDescription>
                Começa e termina sozinha pelo horário se ninguém mexer. Até{" "}
                {INCIDENT_LIMITS.maintenanceMaxHours} horas de duração.
              </FieldDescription>
              <div className="grid gap-4 sm:grid-cols-2">
                <Controller
                  name="scheduledFor"
                  control={form.control}
                  render={({ field, fieldState }) => (
                    <MaintenanceDateField
                      id="novo-incidente-inicio"
                      label="Início"
                      value={field.value}
                      onChange={field.onChange}
                      onBlur={field.onBlur}
                      invalid={fieldState.invalid}
                      error={fieldState.error}
                    />
                  )}
                />
                <Controller
                  name="scheduledUntil"
                  control={form.control}
                  render={({ field, fieldState }) => (
                    <MaintenanceDateField
                      id="novo-incidente-fim"
                      label="Fim"
                      value={field.value}
                      onChange={field.onChange}
                      onBlur={field.onBlur}
                      invalid={fieldState.invalid}
                      error={fieldState.error}
                    />
                  )}
                />
              </div>
            </FieldSet>
          )}

          <Controller
            name="message"
            control={form.control}
            render={({ field, fieldState }) => (
              <IncidentMessageField
                id="novo-incidente-mensagem"
                value={field.value}
                onChange={field.onChange}
                onBlur={field.onBlur}
                invalid={fieldState.invalid}
                error={fieldState.error}
                placeholder={
                  kind === "maintenance"
                    ? "O que vai ficar fora do ar, por quanto tempo e o que o cliente precisa fazer."
                    : "O que o cliente pode notar e quando volta a dar notícia."
                }
              />
            )}
          />
        </FieldGroup>
        <DialogFooter>
          <DialogClose render={<Button type="button" variant="outline" />}>Cancelar</DialogClose>
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? <Spinner data-icon="inline-start" /> : null}
            Publicar
          </Button>
        </DialogFooter>
      </form>
    </>
  )
}

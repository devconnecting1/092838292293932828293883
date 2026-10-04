"use client"

import * as React from "react"
import { zodResolver } from "@hookform/resolvers/zod"
import { CircleAlertIcon, CircleCheckIcon, SendIcon } from "lucide-react"
import { Controller, useForm, useWatch } from "react-hook-form"

import {
  incidentUpdateFormSchema,
  isClosedIncidentStatus,
  nextIncidentStatuses,
  type AnyIncidentStatus,
  type IncidentKind,
  type IncidentUpdateFormValues,
} from "@workspace/core/status/incidents"
import { INCIDENT_STATUS_LABELS } from "@workspace/core/status/public"
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

import { addIncidentUpdateAction } from "@/app/plataforma/status/actions"
import { PLATFORM_READ_ONLY_NOTICE_ID } from "@/components/plataforma/equipe/read-only-notice"
import { IncidentMessageField } from "@/components/plataforma/status/incident-fields"

type IncidentUpdateDialogProps = {
  incidentId: string
  title: string
  kind: IncidentKind
  /** Estado efetivo (o que o público vê agora). */
  status: AnyIncidentStatus
  /** Somente leitura: botão desabilitado (o servidor recusa de qualquer jeito). */
  readOnly?: boolean
}

const STATUS_HINTS: Record<AnyIncidentStatus, string> = {
  investigating: "Ainda procurando a causa.",
  identified: "Causa encontrada, correção em andamento.",
  monitoring: "Correção aplicada, acompanhando se voltou ao normal.",
  resolved:
    "Encerra o incidente: sai de “em aberto”, as partes voltam para a medição automática e não aceita mais atualizações.",
  scheduled: "Continua agendada: serve para avisar mudança ou lembrar.",
  in_progress: "A manutenção começou: as partes aparecem “Em manutenção” até ser concluída.",
  completed:
    "Encerra a manutenção: as partes voltam para a medição automática e não aceita mais atualizações.",
}

/** Botão "Publicar atualização": novo estado + mensagem na linha do tempo pública. */
export function IncidentUpdateDialog({ readOnly = false, ...props }: IncidentUpdateDialogProps) {
  const [open, setOpen] = React.useState(false)

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button
            size="sm"
            disabled={readOnly}
            aria-describedby={readOnly ? PLATFORM_READ_ONLY_NOTICE_ID : undefined}
          />
        }
      >
        <SendIcon data-icon="inline-start" />
        Publicar atualização
      </DialogTrigger>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg">
        {open ? <IncidentUpdateForm {...props} onDone={() => setOpen(false)} /> : null}
      </DialogContent>
    </Dialog>
  )
}

function IncidentUpdateForm({
  incidentId,
  title,
  kind,
  status,
  onDone,
}: IncidentUpdateDialogProps & { onDone: () => void }) {
  const [isSubmitting, startSubmit] = React.useTransition()
  const [formError, setFormError] = React.useState<string | null>(null)
  const allowed = nextIncidentStatuses(kind, status)
  const [context] = React.useState(() => ({ kind, currentStatus: status }))
  const resolver = React.useMemo(() => zodResolver(incidentUpdateFormSchema(context)), [context])

  const form = useForm<IncidentUpdateFormValues>({
    resolver,
    mode: "onTouched",
    defaultValues: {
      status: allowed.includes(status) ? status : (allowed[0] ?? status),
      message: "",
    },
  })

  const selectedStatus = useWatch({ control: form.control, name: "status" })
  const closes = isClosedIncidentStatus(selectedStatus)
  const statusItems = allowed.map((option) => ({
    value: option,
    label: INCIDENT_STATUS_LABELS[option],
  }))

  function onSubmit(values: IncidentUpdateFormValues) {
    setFormError(null)

    startSubmit(async () => {
      const result = await addIncidentUpdateAction(incidentId, values, context)

      if (result.ok) {
        toast.add({ title: result.message, type: "success" })
        onDone()
        return
      }

      for (const [field, message] of Object.entries(result.fieldErrors ?? {})) {
        if (message) {
          form.setError(field as keyof IncidentUpdateFormValues, { type: "server", message })
        }
      }

      setFormError(result.error)
    })
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Publicar atualização</DialogTitle>
        <DialogDescription>
          &ldquo;{title}&rdquo;. A mensagem entra na linha do tempo da página pública /status e na
          faixa do CRM, com o horário de agora.
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
            name="status"
            control={form.control}
            render={({ field, fieldState }) => (
              <Field data-invalid={fieldState.invalid}>
                <FieldLabel htmlFor={`atualizacao-estado-${incidentId}`}>Estado</FieldLabel>
                <Select
                  items={statusItems}
                  value={field.value}
                  onValueChange={(value) => {
                    if (value) field.onChange(value)
                  }}
                  onOpenChange={(isOpen) => {
                    if (!isOpen) field.onBlur()
                  }}
                >
                  <SelectTrigger
                    id={`atualizacao-estado-${incidentId}`}
                    className="w-full"
                    aria-invalid={fieldState.invalid}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {statusItems.map((item) => (
                        <SelectItem key={item.value} value={item.value}>
                          {item.label}
                          {isClosedIncidentStatus(item.value) ? (
                            <span className="text-muted-foreground">· encerra</span>
                          ) : null}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
                {fieldState.invalid ? (
                  <FieldError errors={[fieldState.error]} />
                ) : closes ? null : (
                  <FieldDescription>{STATUS_HINTS[field.value]}</FieldDescription>
                )}
              </Field>
            )}
          />

          {closes ? (
            <Alert>
              <CircleCheckIcon />
              <AlertTitle>
                {INCIDENT_STATUS_LABELS[selectedStatus]} encerra{" "}
                {kind === "maintenance" ? "a manutenção" : "o incidente"}
              </AlertTitle>
              <AlertDescription>{STATUS_HINTS[selectedStatus]}</AlertDescription>
            </Alert>
          ) : null}

          <Controller
            name="message"
            control={form.control}
            render={({ field, fieldState }) => (
              <IncidentMessageField
                id={`atualizacao-mensagem-${incidentId}`}
                value={field.value}
                onChange={field.onChange}
                onBlur={field.onBlur}
                invalid={fieldState.invalid}
                error={fieldState.error}
                placeholder={
                  closes
                    ? "O que foi feito e se o cliente precisa fazer algo."
                    : "O que mudou desde a última atualização e quando volta a dar notícia."
                }
              />
            )}
          />
        </FieldGroup>
        <DialogFooter>
          <DialogClose render={<Button type="button" variant="outline" />}>Cancelar</DialogClose>
          <Button type="submit" disabled={isSubmitting || allowed.length === 0}>
            {isSubmitting ? <Spinner data-icon="inline-start" /> : null}
            {closes ? "Publicar e encerrar" : "Publicar"}
          </Button>
        </DialogFooter>
      </form>
    </>
  )
}

"use client"

import * as React from "react"
import { zodResolver } from "@hookform/resolvers/zod"
import { CircleAlertIcon, LockIcon, PencilIcon } from "lucide-react"
import { Controller, useForm } from "react-hook-form"

import { toBrasiliaInputValue } from "@workspace/core/platform/announcements"
import {
  INCIDENT_LIMITS,
  incidentEditFormSchema,
  isClosedIncidentStatus,
  type AnyIncidentStatus,
  type IncidentEditFormValues,
  type IncidentKind,
} from "@workspace/core/status/incidents"
import type { IncidentImpact, StatusComponentKey } from "@workspace/core/status/public"
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
import { FieldDescription, FieldGroup, FieldLegend, FieldSet } from "@workspace/ui/components/field"
import { Spinner } from "@workspace/ui/components/spinner"
import { toast } from "@workspace/ui/components/toast"

import { editIncidentAction } from "@/app/plataforma/status/actions"
import { PLATFORM_READ_ONLY_NOTICE_ID } from "@/components/plataforma/equipe/read-only-notice"
import {
  IncidentComponentsField,
  IncidentImpactField,
  IncidentTitleField,
  MaintenanceDateField,
} from "@/components/plataforma/status/incident-fields"

type IncidentEditDialogProps = {
  incidentId: string
  kind: IncidentKind
  /** Estado efetivo (o que o público vê agora). */
  status: AnyIncidentStatus
  title: string
  impact: IncidentImpact
  componentKeys: StatusComponentKey[]
  scheduledFor: string | null
  scheduledUntil: string | null
  /** Somente leitura: botão desabilitado (o servidor recusa de qualquer jeito). */
  readOnly?: boolean
}

/** Botão "Editar": título, impacto, partes e (manutenção ainda agendada) a janela. */
export function IncidentEditDialog({ readOnly = false, ...props }: IncidentEditDialogProps) {
  const [open, setOpen] = React.useState(false)

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button
            variant="outline"
            size="sm"
            disabled={readOnly}
            aria-describedby={readOnly ? PLATFORM_READ_ONLY_NOTICE_ID : undefined}
          />
        }
      >
        <PencilIcon data-icon="inline-start" />
        Editar
      </DialogTrigger>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg">
        {open ? <IncidentEditForm {...props} onDone={() => setOpen(false)} /> : null}
      </DialogContent>
    </Dialog>
  )
}

function IncidentEditForm({
  incidentId,
  kind,
  status,
  title,
  impact,
  componentKeys,
  scheduledFor,
  scheduledUntil,
  onDone,
}: IncidentEditDialogProps & { onDone: () => void }) {
  const [isSubmitting, startSubmit] = React.useTransition()
  const [formError, setFormError] = React.useState<string | null>(null)
  const closed = isClosedIncidentStatus(status)
  const windowEditable = kind === "maintenance" && status === "scheduled"
  const [context] = React.useState(() => ({ kind, status, impact, componentKeys }))
  const resolver = React.useMemo(() => zodResolver(incidentEditFormSchema(context)), [context])

  const form = useForm<IncidentEditFormValues>({
    resolver,
    mode: "onTouched",
    defaultValues: {
      title,
      impact,
      componentKeys: [...componentKeys],
      scheduledFor: scheduledFor ? toBrasiliaInputValue(scheduledFor) : "",
      scheduledUntil: scheduledUntil ? toBrasiliaInputValue(scheduledUntil) : "",
    },
  })

  function onSubmit(values: IncidentEditFormValues) {
    setFormError(null)

    startSubmit(async () => {
      const result = await editIncidentAction(incidentId, values, context)

      if (result.ok) {
        toast.add({ title: result.message, type: "success" })
        onDone()
        return
      }

      for (const [field, message] of Object.entries(result.fieldErrors ?? {})) {
        if (message) {
          form.setError(field as keyof IncidentEditFormValues, { type: "server", message })
        }
      }

      setFormError(result.error)
    })
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>
          {kind === "maintenance" ? "Editar manutenção" : "Editar incidente"}
        </DialogTitle>
        <DialogDescription>
          A mudança aparece na hora na página pública /status e na faixa do CRM. Para contar o que
          aconteceu, publique uma atualização em vez de reescrever o título.
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

          {closed ? (
            <Alert>
              <LockIcon />
              <AlertTitle>Registro encerrado: só o título pode ser corrigido</AlertTitle>
              <AlertDescription>
                Impacto e partes afetadas contam o histórico e ficam como estavam.
              </AlertDescription>
            </Alert>
          ) : null}

          <Controller
            name="title"
            control={form.control}
            render={({ field, fieldState }) => (
              <IncidentTitleField
                id={`editar-incidente-titulo-${incidentId}`}
                value={field.value}
                onChange={field.onChange}
                onBlur={field.onBlur}
                invalid={fieldState.invalid}
                error={fieldState.error}
                placeholder="Título que os clientes veem"
              />
            )}
          />

          <Controller
            name="impact"
            control={form.control}
            render={({ field, fieldState }) => (
              <IncidentImpactField
                id={`editar-incidente-impacto-${incidentId}`}
                kind={kind}
                value={field.value}
                onChange={field.onChange}
                onBlur={field.onBlur}
                invalid={fieldState.invalid}
                error={fieldState.error}
                disabled={closed}
                lockedHint="Registro encerrado: o impacto não muda mais."
              />
            )}
          />

          <Controller
            name="componentKeys"
            control={form.control}
            render={({ field, fieldState }) => (
              <IncidentComponentsField
                id={`editar-incidente-partes-${incidentId}`}
                description={
                  closed
                    ? "Registro encerrado: as partes afetadas não mudam mais."
                    : "Marque só o que o cliente sente. As demais partes seguem a medição automática."
                }
                value={field.value}
                onChange={field.onChange}
                onBlur={field.onBlur}
                invalid={fieldState.invalid}
                error={fieldState.error}
                disabled={closed}
              />
            )}
          />

          {windowEditable ? (
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
                      id={`editar-incidente-inicio-${incidentId}`}
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
                      id={`editar-incidente-fim-${incidentId}`}
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
          ) : null}
        </FieldGroup>
        <DialogFooter>
          <DialogClose render={<Button type="button" variant="outline" />}>Cancelar</DialogClose>
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? <Spinner data-icon="inline-start" /> : null}
            Salvar alterações
          </Button>
        </DialogFooter>
      </form>
    </>
  )
}

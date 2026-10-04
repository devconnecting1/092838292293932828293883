"use client"

import * as React from "react"
import { zodResolver } from "@hookform/resolvers/zod"
import { CircleAlertIcon } from "lucide-react"
import { Controller, useForm } from "react-hook-form"

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
import { toast } from "@workspace/ui/components/toast"

import { DatePicker } from "@/components/agenda/date-picker"
import { PropertyCombobox } from "@/components/agenda/property-combobox"
import { ClientCombobox } from "@/components/clientes/client-combobox"
import { saveAppointment } from "@/lib/agenda/actions"
import { isDateKey, isTimeKey, toDateKey, toTimeKey } from "@/lib/agenda/datetime"
import { getVisitBrokers } from "@/lib/agenda/labels"
import { canScheduleForOthers } from "@/lib/agenda/permissions"
import {
  appointmentFormSchema,
  MEETING_POINT_MAX_LENGTH,
  type AppointmentFormValues,
} from "@/lib/agenda/schemas"
import type { Role } from "@/lib/auth/roles"
import type { ClientOption, MemberOption, PropertyOption } from "@/lib/clientes/options"
import { FormDraftNotice } from "@/lib/forms/draft/form-draft-notice"
import { useFormDraft } from "@/lib/forms/draft/use-form-draft"
import { useFormDraftScope } from "@/lib/forms/draft/use-form-draft-scope"
import { useGuardedSubmit } from "@/lib/forms/submit/use-guarded-submit"
import { UnsavedChangesGuard } from "@/lib/forms/unsaved/unsaved-changes-guard"

export type AppointmentFormDialogProps = {
  members: MemberOption[]
  currentUserId: string
  role: Role
  /** Visita existente (edição). Sem valor: nova visita. */
  appointment?: {
    id: string
    property: PropertyOption | null
    client: ClientOption | null
    brokerId: string | null
    startsAt: string // ISO
    endsAt: string | null
    meetingPoint: string | null
  }
  /** Valores iniciais de nova visita (ex.: ficha do cliente com imóvel compatível). */
  defaults?: {
    client?: ClientOption | null
    property?: PropertyOption | null
    dateKey?: string
  }
  /** Elemento do gatilho, ex.: <Button variant="outline" size="sm" />. Use <DialogTrigger render={trigger}>{children}</DialogTrigger>. */
  trigger: React.ReactElement
  children: React.ReactNode
  onSaved?: () => void
}

type AppointmentFormBaseProps = Omit<AppointmentFormDialogProps, "trigger" | "children">

const DEFAULT_START_TIME = "09:00"
const LAST_MINUTE_OF_DAY = 23 * 60 + 59
const FORM_FIELDS = [
  "property",
  "client",
  "brokerId",
  "date",
  "startTime",
  "endTime",
  "meetingPoint",
] as const satisfies readonly (keyof AppointmentFormValues)[]

function isFormField(value: string): value is (typeof FORM_FIELDS)[number] {
  return (FORM_FIELDS as readonly string[]).includes(value)
}

/** "HH:MM" uma hora depois (limitado a 23:59, a visita não vira o dia). */
function addOneHour(time: string) {
  if (!isTimeKey(time)) {
    return ""
  }

  const [hours = 0, minutes = 0] = time.split(":").map(Number)
  const total = Math.min(hours * 60 + minutes + 60, LAST_MINUTE_OF_DAY)

  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`
}

function buildDefaultValues(
  { appointment, defaults, currentUserId }: AppointmentFormBaseProps,
  todayKey: string
): AppointmentFormValues {
  if (appointment) {
    const startTime = toTimeKey(appointment.startsAt)

    return {
      property: appointment.property,
      client: appointment.client,
      brokerId: appointment.brokerId ?? currentUserId,
      date: toDateKey(appointment.startsAt),
      startTime,
      endTime: appointment.endsAt ? toTimeKey(appointment.endsAt) : addOneHour(startTime),
      meetingPoint: appointment.meetingPoint ?? "",
    }
  }

  return {
    property: defaults?.property ?? null,
    client: defaults?.client ?? null,
    brokerId: currentUserId,
    date: defaults?.dateKey && isDateKey(defaults.dateKey) ? defaults.dateKey : todayKey,
    startTime: DEFAULT_START_TIME,
    endTime: addOneHour(DEFAULT_START_TIME),
    meetingPoint: "",
  }
}

/** Diálogo de nova visita/edição aberto por um gatilho. */
export function AppointmentFormDialog({ trigger, children, ...props }: AppointmentFormDialogProps) {
  const [open, setOpen] = React.useState(false)
  const [todayKey, setTodayKey] = React.useState("")

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        // "Hoje" calculado no evento (e não no render) para o padrão da data.
        if (nextOpen) setTodayKey(toDateKey(new Date()))
        setOpen(nextOpen)
      }}
    >
      <DialogTrigger render={trigger}>{children}</DialogTrigger>
      <AppointmentFormDialogContent {...props} todayKey={todayKey} onClose={() => setOpen(false)} />
    </Dialog>
  )
}

/** Mesmo diálogo, controlado pelo pai (ex.: item "Editar" de um menu). */
export function ControlledAppointmentFormDialog({
  open,
  onOpenChange,
  ...props
}: AppointmentFormBaseProps & {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <AppointmentFormDialogContent {...props} todayKey="" onClose={() => onOpenChange(false)} />
    </Dialog>
  )
}

function AppointmentFormDialogContent(
  props: AppointmentFormBaseProps & { todayKey: string; onClose: () => void }
) {
  return (
    <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg">
      {/* O formulário monta a cada abertura: os valores voltam ao padrão. */}
      <AppointmentForm {...props} />
    </DialogContent>
  )
}

function AppointmentForm({
  todayKey,
  onClose,
  ...props
}: AppointmentFormBaseProps & { todayKey: string; onClose: () => void }) {
  const { members, currentUserId, role, appointment, onSaved } = props
  const isEdit = Boolean(appointment)
  const canChooseBroker = canScheduleForOthers(role)
  const brokers = getVisitBrokers(members)
  const { isPending: isSaving, run: runSave } = useGuardedSubmit()
  const [formError, setFormError] = React.useState<string | null>(null)

  const form = useForm<AppointmentFormValues>({
    resolver: zodResolver(appointmentFormSchema),
    mode: "onTouched",
    defaultValues: buildDefaultValues(props, todayKey),
  })
  const { isDirty } = form.formState

  // Internet caiu ou o diálogo fechou sem querer: o agendamento volta na próxima abertura.
  const draftScope = useFormDraftScope({ userId: currentUserId })
  const draft = useFormDraft({
    form,
    scope: draftScope,
    formId: "visita",
    recordId: appointment?.id ?? null,
  })

  function onSubmit(values: AppointmentFormValues) {
    setFormError(null)

    runSave(
      async () => {
        const result = await saveAppointment({ ...values, id: appointment?.id })

        if (!result.ok) {
          for (const [path, message] of Object.entries(result.fieldErrors ?? {})) {
            const field = path.split(".")[0] ?? ""

            if (isFormField(field)) {
              form.setError(field, { type: "server", message })
            }
          }

          toast.add({
            title: isEdit
              ? "Não foi possível salvar a visita"
              : "Não foi possível agendar a visita",
            description: result.error,
            type: "error",
          })
          return
        }

        toast.add({
          title: result.message ?? (isEdit ? "Visita atualizada." : "Visita agendada."),
          type: "success",
        })
        draft.clear()
        onClose()
        onSaved?.()
      },
      ({ message }) => {
        // Queda de rede ou erro inesperado: o diálogo continua aberto com os campos.
        draft.saveNow()
        setFormError(message)
      }
    )
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} noValidate className="flex flex-col gap-4">
      <DialogHeader>
        <DialogTitle>{isEdit ? "Editar visita" : "Nova visita"}</DialogTitle>
        <DialogDescription>
          {isEdit
            ? "Altere o imóvel, o cliente, o corretor ou o horário da visita."
            : "Agende a visita a um imóvel. O cliente é opcional."}
        </DialogDescription>
      </DialogHeader>
      <UnsavedChangesGuard when={isDirty} />

      <FieldGroup>
        <FormDraftNotice draft={draft} />
        {formError ? (
          <Alert variant="destructive">
            <CircleAlertIcon />
            <AlertTitle>
              {isEdit ? "Não foi possível salvar a visita" : "Não foi possível agendar a visita"}
            </AlertTitle>
            <AlertDescription>{formError}</AlertDescription>
          </Alert>
        ) : null}
        <Controller
          name="property"
          control={form.control}
          render={({ field, fieldState }) => (
            <Field data-invalid={fieldState.invalid}>
              <FieldLabel htmlFor="appointment-property">Imóvel</FieldLabel>
              <PropertyCombobox
                id="appointment-property"
                value={field.value}
                onValueChange={field.onChange}
                onBlur={field.onBlur}
                invalid={fieldState.invalid}
                disabled={isSaving}
              />
              {fieldState.invalid ? <FieldError errors={[fieldState.error]} /> : null}
            </Field>
          )}
        />

        <Controller
          name="client"
          control={form.control}
          render={({ field, fieldState }) => (
            <Field data-invalid={fieldState.invalid}>
              <FieldLabel htmlFor="appointment-client">Cliente (opcional)</FieldLabel>
              <ClientCombobox
                id="appointment-client"
                value={field.value}
                onValueChange={field.onChange}
                onBlur={field.onBlur}
                invalid={fieldState.invalid}
                disabled={isSaving}
              />
              {fieldState.invalid ? (
                <FieldError errors={[fieldState.error]} />
              ) : (
                <FieldDescription>Com cliente, a visita entra no histórico dele.</FieldDescription>
              )}
            </Field>
          )}
        />

        <Controller
          name="brokerId"
          control={form.control}
          render={({ field, fieldState }) => {
            const items = [
              { label: "Selecione o corretor", value: null as string | null },
              ...brokers.map((member) => ({
                label: member.name,
                value: member.id as string | null,
              })),
            ]

            // Corretor atual fora da lista (ex-membro ou papel sem visita): mantém o rótulo.
            if (field.value && !brokers.some((member) => member.id === field.value)) {
              items.push({
                label: field.value === currentUserId ? "Você" : "Ex-membro",
                value: field.value,
              })
            }

            const disabled = !canChooseBroker || isSaving

            return (
              <Field data-invalid={fieldState.invalid} data-disabled={disabled || undefined}>
                <FieldLabel htmlFor="appointment-broker">Corretor</FieldLabel>
                <Select
                  items={items}
                  value={field.value || null}
                  onValueChange={(value) => field.onChange(value ?? "")}
                  onOpenChange={(open) => {
                    if (!open) field.onBlur()
                  }}
                  disabled={disabled}
                >
                  <SelectTrigger
                    id="appointment-broker"
                    className="w-full"
                    aria-invalid={fieldState.invalid}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {items.map((item) => (
                        <SelectItem key={item.value ?? "placeholder"} value={item.value}>
                          {item.label}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
                {fieldState.invalid ? (
                  <FieldError errors={[fieldState.error]} />
                ) : !canChooseBroker ? (
                  <FieldDescription>
                    Corretores e captadores agendam visitas só para si.
                  </FieldDescription>
                ) : null}
              </Field>
            )
          }}
        />

        <div className="grid gap-5 sm:grid-cols-3">
          <Controller
            name="date"
            control={form.control}
            render={({ field, fieldState }) => (
              <Field data-invalid={fieldState.invalid}>
                <FieldLabel htmlFor="appointment-date">Data</FieldLabel>
                <DatePicker
                  id="appointment-date"
                  value={field.value}
                  onChange={field.onChange}
                  onBlur={field.onBlur}
                  invalid={fieldState.invalid}
                  disabled={isSaving}
                  placeholder="Data"
                />
                {fieldState.invalid ? <FieldError errors={[fieldState.error]} /> : null}
              </Field>
            )}
          />
          <Controller
            name="startTime"
            control={form.control}
            render={({ field, fieldState }) => (
              <Field data-invalid={fieldState.invalid}>
                <FieldLabel htmlFor="appointment-start">Início</FieldLabel>
                <Input
                  {...field}
                  id="appointment-start"
                  type="time"
                  aria-invalid={fieldState.invalid}
                  disabled={isSaving}
                  onChange={(event) => {
                    const startTime = event.target.value
                    const endTime = form.getValues("endTime")
                    field.onChange(startTime)

                    // Sugere 1 h de duração até o término ser ajustado à mão.
                    if (
                      isTimeKey(startTime) &&
                      (!isTimeKey(endTime) ||
                        endTime <= startTime ||
                        (!isEdit && !form.getFieldState("endTime").isDirty))
                    ) {
                      form.setValue("endTime", addOneHour(startTime), {
                        shouldValidate: form.formState.isSubmitted,
                      })
                    }
                  }}
                />
                {fieldState.invalid ? <FieldError errors={[fieldState.error]} /> : null}
              </Field>
            )}
          />
          <Controller
            name="endTime"
            control={form.control}
            render={({ field, fieldState }) => (
              <Field data-invalid={fieldState.invalid}>
                <FieldLabel htmlFor="appointment-end">Término</FieldLabel>
                <Input
                  {...field}
                  id="appointment-end"
                  type="time"
                  aria-invalid={fieldState.invalid}
                  disabled={isSaving}
                />
                {fieldState.invalid ? <FieldError errors={[fieldState.error]} /> : null}
              </Field>
            )}
          />
        </div>

        <Controller
          name="meetingPoint"
          control={form.control}
          render={({ field, fieldState }) => (
            <Field data-invalid={fieldState.invalid}>
              <FieldLabel htmlFor="appointment-meeting-point">
                Ponto de encontro (opcional)
              </FieldLabel>
              <Input
                {...field}
                id="appointment-meeting-point"
                maxLength={MEETING_POINT_MAX_LENGTH}
                placeholder="Ex.: portaria do condomínio"
                aria-invalid={fieldState.invalid}
                disabled={isSaving}
              />
              {fieldState.invalid ? <FieldError errors={[fieldState.error]} /> : null}
            </Field>
          )}
        />
      </FieldGroup>

      <DialogFooter>
        <DialogClose render={<Button type="button" variant="outline" />}>Cancelar</DialogClose>
        <Button type="submit" disabled={isSaving}>
          {isSaving ? <Spinner data-icon="inline-start" /> : null}
          {isEdit ? "Salvar alterações" : "Agendar visita"}
        </Button>
      </DialogFooter>
    </form>
  )
}

"use client"

import * as React from "react"
import { zodResolver } from "@hookform/resolvers/zod"
import { CircleAlertIcon } from "lucide-react"
import { Controller, useForm, useWatch, type Path } from "react-hook-form"

import { TASK_PRIORITY_LABELS } from "@workspace/core/properties/enums"
import type { Enums } from "@workspace/database/types"
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
  FieldTitle,
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
import { ToggleGroup, ToggleGroupItem } from "@workspace/ui/components/toggle-group"

import { DatePicker } from "@/components/agenda/date-picker"
import { PropertyCombobox } from "@/components/agenda/property-combobox"
import { ClientCombobox } from "@/components/clientes/client-combobox"
import type { Role } from "@/lib/auth/roles"
import type { ClientOption, MemberOption, PropertyOption } from "@/lib/clientes/options"
import { FormDraftNotice } from "@/lib/forms/draft/form-draft-notice"
import { useFormDraft } from "@/lib/forms/draft/use-form-draft"
import { useFormDraftScope } from "@/lib/forms/draft/use-form-draft-scope"
import { useGuardedSubmit } from "@/lib/forms/submit/use-guarded-submit"
import { UnsavedChangesGuard } from "@/lib/forms/unsaved/unsaved-changes-guard"
import { saveTask } from "@/lib/tarefas/actions"
import { dueIsoToInput } from "@/lib/tarefas/due"
import { canCreateTasks } from "@/lib/tarefas/permissions"
import {
  TASK_DESCRIPTION_MAX_LENGTH,
  TASK_PRIORITIES,
  TASK_TITLE_MAX_LENGTH,
  taskFormSchema,
  type TaskFormValues,
} from "@/lib/tarefas/schemas"

export type TaskFormDialogProps = {
  members: MemberOption[]
  currentUserId: string
  role: Role
  /** Tarefa existente (edição). Sem valor: nova tarefa. */
  task?: {
    id: string
    title: string
    description: string | null
    assigneeId: string | null
    dueAt: string | null // ISO
    priority: Enums<"task_priority">
    client: ClientOption | null
    property: PropertyOption | null
  }
  /** Valores iniciais de nova tarefa (ex.: a partir da ficha do cliente). */
  defaults?: {
    client?: ClientOption | null
    property?: PropertyOption | null
    assigneeId?: string | null
  }
  /** Elemento do gatilho, ex.: <Button variant="outline" size="sm" />. */
  trigger: React.ReactElement
  children: React.ReactNode
  onSaved?: () => void
}

/** Variante controlada (ex.: aberta a partir de um DropdownMenu). */
export type ControlledTaskFormDialogProps = Omit<TaskFormDialogProps, "trigger" | "children"> & {
  open: boolean
  onOpenChange: (open: boolean) => void
}

type TaskFormBodyProps = Omit<TaskFormDialogProps, "trigger" | "children"> & {
  onClose: () => void
}

const FORM_FIELD_NAMES = [
  "title",
  "description",
  "assigneeId",
  "dueDate",
  "dueTime",
  "priority",
  "client",
  "property",
] as const satisfies readonly Path<TaskFormValues>[]

function isFormFieldName(value: string): value is (typeof FORM_FIELD_NAMES)[number] {
  return (FORM_FIELD_NAMES as readonly string[]).includes(value)
}

/** Diálogo de nova tarefa / edição, aberto pelo elemento `trigger`. */
export function TaskFormDialog({ trigger, children, ...props }: TaskFormDialogProps) {
  const [open, setOpen] = React.useState(false)

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={trigger}>{children}</DialogTrigger>
      <TaskFormDialogContent {...props} onClose={() => setOpen(false)} />
    </Dialog>
  )
}

export function ControlledTaskFormDialog({
  open,
  onOpenChange,
  ...props
}: ControlledTaskFormDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <TaskFormDialogContent {...props} onClose={() => onOpenChange(false)} />
    </Dialog>
  )
}

function TaskFormDialogContent(props: TaskFormBodyProps) {
  const isEditing = Boolean(props.task)

  // O conteúdo do Dialog só é montado aberto: cada abertura recomeça o formulário.
  return (
    <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg">
      <DialogHeader>
        <DialogTitle>{isEditing ? "Editar tarefa" : "Nova tarefa"}</DialogTitle>
        <DialogDescription>
          {isEditing
            ? "Atualize o que precisa ser feito, o responsável e o prazo."
            : "Registre o que precisa ser feito, quem é o responsável e até quando."}
        </DialogDescription>
      </DialogHeader>
      <TaskForm {...props} />
    </DialogContent>
  )
}

function getDefaultValues({
  task,
  defaults,
  currentUserId,
}: Pick<TaskFormBodyProps, "task" | "defaults" | "currentUserId">): TaskFormValues {
  if (task) {
    return {
      id: task.id,
      title: task.title,
      description: task.description ?? "",
      assigneeId: task.assigneeId ?? "",
      ...dueIsoToInput(task.dueAt),
      priority: task.priority,
      client: task.client,
      property: task.property,
    }
  }

  return {
    id: null,
    title: "",
    description: "",
    assigneeId: defaults?.assigneeId || currentUserId,
    dueDate: "",
    dueTime: "",
    priority: "medium",
    client: defaults?.client ?? null,
    property: defaults?.property ?? null,
  }
}

function TaskForm({
  members,
  currentUserId,
  role,
  task,
  defaults,
  onSaved,
  onClose,
}: TaskFormBodyProps) {
  const { isPending: isSubmitting, run: runSubmit } = useGuardedSubmit()
  const [formError, setFormError] = React.useState<string | null>(null)
  const isEditing = Boolean(task)
  const canSubmit = isEditing || canCreateTasks(role)

  const form = useForm<TaskFormValues>({
    resolver: zodResolver(taskFormSchema),
    mode: "onTouched",
    defaultValues: getDefaultValues({ task, defaults, currentUserId }),
  })
  const { isDirty } = form.formState

  // Internet caiu ou o diálogo fechou sem querer: a tarefa volta na próxima abertura.
  const draftScope = useFormDraftScope({ userId: currentUserId }, canSubmit)
  const draft = useFormDraft({
    form,
    scope: draftScope,
    formId: "tarefa",
    recordId: task?.id ?? null,
    // O id vem do registro aberto, nunca do rascunho.
    exclude: ["id"],
    enabled: canSubmit,
  })
  const hasDueDate = Boolean(useWatch({ control: form.control, name: "dueDate" }))

  const assigneeItems: { label: string; value: string | null }[] = [
    { label: "Selecione o responsável", value: null },
    ...members.map((member) => ({
      label: member.id === currentUserId ? `${member.name} (você)` : member.name,
      value: member.id,
    })),
  ]

  // Responsável que saiu da equipe continua visível na edição.
  if (task?.assigneeId && !members.some((member) => member.id === task.assigneeId)) {
    assigneeItems.push({ label: "Ex-membro", value: task.assigneeId })
  }

  function onSubmit(values: TaskFormValues) {
    setFormError(null)

    runSubmit(
      async () => {
        const result = await saveTask(values)

        if (!result.ok) {
          for (const [key, message] of Object.entries(result.fieldErrors ?? {})) {
            const name = key.split(".")[0] ?? ""

            if (message && isFormFieldName(name)) {
              form.setError(name, { type: "server", message })
            }
          }

          setFormError(result.error)
          return
        }

        draft.clear()
        toast.add({ title: result.message ?? "Tarefa salva.", type: "success" })
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
    <form onSubmit={form.handleSubmit(onSubmit)} noValidate className="flex flex-col gap-6">
      <UnsavedChangesGuard when={isDirty} />
      <FieldGroup>
        <FormDraftNotice draft={draft} />
        {formError ? (
          <Alert variant="destructive">
            <CircleAlertIcon />
            <AlertTitle>Não foi possível salvar</AlertTitle>
            <AlertDescription>{formError}</AlertDescription>
          </Alert>
        ) : null}
        {!canSubmit ? (
          <Alert>
            <CircleAlertIcon />
            <AlertTitle>Sem permissão</AlertTitle>
            <AlertDescription>
              Seu papel nesta imobiliária não permite criar tarefas.
            </AlertDescription>
          </Alert>
        ) : null}

        <Controller
          name="title"
          control={form.control}
          render={({ field, fieldState }) => (
            <Field data-invalid={fieldState.invalid}>
              <FieldLabel htmlFor="tarefa-titulo">Título</FieldLabel>
              <Input
                {...field}
                id="tarefa-titulo"
                placeholder="Ex.: Ligar para o proprietário sobre a visita"
                maxLength={TASK_TITLE_MAX_LENGTH}
                autoComplete="off"
                aria-invalid={fieldState.invalid}
              />
              {fieldState.invalid ? <FieldError errors={[fieldState.error]} /> : null}
            </Field>
          )}
        />

        <Controller
          name="description"
          control={form.control}
          render={({ field, fieldState }) => (
            <Field data-invalid={fieldState.invalid}>
              <FieldLabel htmlFor="tarefa-descricao">Descrição (opcional)</FieldLabel>
              <Textarea
                {...field}
                id="tarefa-descricao"
                rows={3}
                maxLength={TASK_DESCRIPTION_MAX_LENGTH}
                placeholder="Detalhes, contexto ou próximos passos"
                aria-invalid={fieldState.invalid}
              />
              {fieldState.invalid ? <FieldError errors={[fieldState.error]} /> : null}
            </Field>
          )}
        />

        <Controller
          name="assigneeId"
          control={form.control}
          render={({ field, fieldState }) => (
            <Field data-invalid={fieldState.invalid}>
              <FieldLabel htmlFor="tarefa-responsavel">Responsável</FieldLabel>
              <Select
                items={assigneeItems}
                value={field.value || null}
                onValueChange={(value: string | null) => field.onChange(value ?? "")}
                onOpenChange={(open) => {
                  if (!open) field.onBlur()
                }}
              >
                <SelectTrigger
                  id="tarefa-responsavel"
                  className="w-full"
                  aria-invalid={fieldState.invalid}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {assigneeItems
                      .filter((item) => item.value !== null)
                      .map((item) => (
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

        <div className="grid gap-5 sm:grid-cols-[1fr_9rem]">
          <Controller
            name="dueDate"
            control={form.control}
            render={({ field, fieldState }) => (
              <Field data-invalid={fieldState.invalid}>
                <FieldLabel htmlFor="tarefa-prazo-data">Prazo (opcional)</FieldLabel>
                <DatePicker
                  id="tarefa-prazo-data"
                  value={field.value}
                  onChange={(value) => {
                    field.onChange(value)

                    if (!value) {
                      form.setValue("dueTime", "", {
                        shouldValidate: form.formState.isSubmitted,
                      })
                    }
                  }}
                  onBlur={field.onBlur}
                  placeholder="Sem prazo"
                  invalid={fieldState.invalid}
                />
                {fieldState.invalid ? <FieldError errors={[fieldState.error]} /> : null}
              </Field>
            )}
          />
          <Controller
            name="dueTime"
            control={form.control}
            render={({ field, fieldState }) => (
              <Field data-invalid={fieldState.invalid} data-disabled={!hasDueDate || undefined}>
                <FieldLabel htmlFor="tarefa-prazo-hora">Hora (opcional)</FieldLabel>
                <Input
                  {...field}
                  id="tarefa-prazo-hora"
                  type="time"
                  disabled={!hasDueDate}
                  aria-invalid={fieldState.invalid}
                />
                {fieldState.invalid ? <FieldError errors={[fieldState.error]} /> : null}
              </Field>
            )}
          />
        </div>
        <FieldDescription className="-mt-3">
          Sem hora, a tarefa vence no fim do dia (horário de Brasília).
        </FieldDescription>

        <Controller
          name="priority"
          control={form.control}
          render={({ field, fieldState }) => (
            <Field data-invalid={fieldState.invalid}>
              <FieldTitle id="tarefa-prioridade-rotulo">Prioridade</FieldTitle>
              <ToggleGroup
                aria-labelledby="tarefa-prioridade-rotulo"
                variant="outline"
                value={[field.value]}
                onValueChange={(value) => {
                  const next = value[0]

                  if (next === "low" || next === "medium" || next === "high") {
                    field.onChange(next)
                  }
                }}
              >
                {TASK_PRIORITIES.map((priority) => (
                  <ToggleGroupItem key={priority} value={priority}>
                    {TASK_PRIORITY_LABELS[priority]}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
              {fieldState.invalid ? <FieldError errors={[fieldState.error]} /> : null}
            </Field>
          )}
        />

        <Controller
          name="client"
          control={form.control}
          render={({ field, fieldState }) => (
            <Field data-invalid={fieldState.invalid}>
              <FieldLabel htmlFor="tarefa-cliente">Cliente (opcional)</FieldLabel>
              <ClientCombobox
                id="tarefa-cliente"
                value={field.value}
                onValueChange={field.onChange}
                onBlur={field.onBlur}
                invalid={fieldState.invalid}
              />
              {fieldState.invalid ? <FieldError errors={[fieldState.error]} /> : null}
            </Field>
          )}
        />

        <Controller
          name="property"
          control={form.control}
          render={({ field, fieldState }) => (
            <Field data-invalid={fieldState.invalid}>
              <FieldLabel htmlFor="tarefa-imovel">Imóvel (opcional)</FieldLabel>
              <PropertyCombobox
                id="tarefa-imovel"
                value={field.value}
                onValueChange={field.onChange}
                onBlur={field.onBlur}
                invalid={fieldState.invalid}
              />
              {fieldState.invalid ? <FieldError errors={[fieldState.error]} /> : null}
            </Field>
          )}
        />
      </FieldGroup>

      <DialogFooter>
        <DialogClose render={<Button type="button" variant="outline" />}>Cancelar</DialogClose>
        <Button type="submit" disabled={isSubmitting || !canSubmit}>
          {isSubmitting ? <Spinner data-icon="inline-start" /> : null}
          {isEditing ? "Salvar alterações" : "Criar tarefa"}
        </Button>
      </DialogFooter>
    </form>
  )
}

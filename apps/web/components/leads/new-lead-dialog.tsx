"use client"

import * as React from "react"
import { zodResolver } from "@hookform/resolvers/zod"
import { CircleAlertIcon, InfoIcon } from "lucide-react"
import { Controller, useForm, useWatch } from "react-hook-form"

import { Alert, AlertDescription, AlertTitle } from "@workspace/ui/components/alert"
import { Button } from "@workspace/ui/components/button"
import { Checkbox } from "@workspace/ui/components/checkbox"
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
import { toDateKey } from "@/lib/agenda/datetime"
import type { Role } from "@/lib/auth/roles"
import { maskPhoneInput } from "@/lib/clientes/format"
import type { MemberOption } from "@/lib/clientes/options"
import { FormDraftNotice } from "@/lib/forms/draft/form-draft-notice"
import { useFormDraft } from "@/lib/forms/draft/use-form-draft"
import { useFormDraftScope } from "@/lib/forms/draft/use-form-draft-scope"
import { useGuardedSubmit } from "@/lib/forms/submit/use-guarded-submit"
import { UnsavedChangesGuard } from "@/lib/forms/unsaved/unsaved-changes-guard"
import { createLead } from "@/lib/leads/actions"
import {
  LEAD_INTEREST_LABELS,
  LEAD_INTERESTS,
  LEAD_MESSAGE_MAX_LENGTH,
  LEAD_NAME_MAX_LENGTH,
  LEAD_SOURCE_LABELS,
  MANUAL_LEAD_SOURCES,
} from "@/lib/leads/constants"
import { canChooseLeadAssignee, canCreateLeads } from "@/lib/leads/permissions"
import {
  EMPTY_NEW_LEAD_FORM_VALUES,
  newLeadFormSchema,
  type NewLeadFormValues,
} from "@/lib/leads/schemas"

const SOURCE_ITEMS = MANUAL_LEAD_SOURCES.map((source) => ({
  label: LEAD_SOURCE_LABELS[source],
  value: source,
}))

const FORM_FIELDS = [
  "name",
  "email",
  "phone",
  "source",
  "interest",
  "property",
  "assignedTo",
  "message",
  "hasConsent",
  "consentDate",
] as const satisfies readonly (keyof NewLeadFormValues)[]

function isFormField(value: string): value is (typeof FORM_FIELDS)[number] {
  return (FORM_FIELDS as readonly string[]).includes(value)
}

type NewLeadDialogProps = {
  members: MemberOption[]
  currentUserId: string
  /**
   * Imobiliária atual, para o rascunho local. Sem ela, o formulário pergunta
   * ao servidor ao abrir (uma chamada a mais).
   */
  organizationId?: string
  role: Role
  /** Elemento do gatilho, ex.: <Button />. */
  trigger: React.ReactElement
  children: React.ReactNode
}

/** Cadastro manual de lead (telefone, portal, indicação, redes sociais…). */
export function NewLeadDialog({ trigger, children, ...props }: NewLeadDialogProps) {
  const [open, setOpen] = React.useState(false)

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={trigger}>{children}</DialogTrigger>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg">
        {/* Montado a cada abertura: os valores voltam ao padrão. */}
        <NewLeadForm {...props} onClose={() => setOpen(false)} />
      </DialogContent>
    </Dialog>
  )
}

function NewLeadForm({
  members,
  currentUserId,
  organizationId,
  role,
  onClose,
}: Omit<NewLeadDialogProps, "trigger" | "children"> & { onClose: () => void }) {
  const { isPending: isSaving, run: runSave } = useGuardedSubmit()
  const [formError, setFormError] = React.useState<string | null>(null)
  const canChoose = canChooseLeadAssignee(role)
  const canCreate = canCreateLeads(role)

  const form = useForm<NewLeadFormValues>({
    resolver: zodResolver(newLeadFormSchema),
    mode: "onTouched",
    defaultValues: {
      ...EMPTY_NEW_LEAD_FORM_VALUES,
      assignedTo: canChoose ? "" : currentUserId,
    },
  })
  const hasConsent = useWatch({ control: form.control, name: "hasConsent" })
  const { isDirty } = form.formState

  // Fechar o diálogo ou a aba sem querer não perde o cadastro: o rascunho volta na próxima abertura.
  const draftScope = useFormDraftScope({ userId: currentUserId, organizationId }, canCreate)
  const draft = useFormDraft({ form, scope: draftScope, formId: "lead", enabled: canCreate })

  const currentMember = members.find((member) => member.id === currentUserId)
  const assigneeItems: { label: string; value: string | null }[] = canChoose
    ? [
        { label: "Sem responsável", value: null },
        ...members.map((member) => ({
          label: member.id === currentUserId ? `${member.name} (você)` : member.name,
          value: member.id,
        })),
      ]
    : [
        {
          label: `${currentMember?.name ?? "Você"} (você)`,
          value: currentUserId,
        },
        { label: "Sem responsável", value: null },
      ]

  function onSubmit(values: NewLeadFormValues) {
    setFormError(null)

    runSave(
      async () => {
        const result = await createLead(values)

        if (!result.ok) {
          for (const [path, message] of Object.entries(result.fieldErrors ?? {})) {
            const field = path.split(".")[0] ?? ""

            if (isFormField(field)) {
              form.setError(field, { type: "server", message })
            }
          }

          setFormError(result.error)
          return
        }

        draft.clear()
        toast.add({
          title: result.message ?? "Lead cadastrado.",
          type: "success",
        })
        onClose()
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
      <DialogHeader>
        <DialogTitle>Novo lead</DialogTitle>
        <DialogDescription>
          Cadastre um contato que chegou por telefone, portal, indicação ou redes sociais.
        </DialogDescription>
      </DialogHeader>
      <UnsavedChangesGuard when={isDirty} />

      <FieldGroup>
        <FormDraftNotice draft={draft} />
        {formError ? (
          <Alert variant="destructive">
            <CircleAlertIcon />
            <AlertTitle>Não foi possível cadastrar</AlertTitle>
            <AlertDescription>{formError}</AlertDescription>
          </Alert>
        ) : null}
        {!canCreate ? (
          <Alert>
            <CircleAlertIcon />
            <AlertTitle>Sem permissão</AlertTitle>
            <AlertDescription>
              Seu papel nesta imobiliária não permite cadastrar leads.
            </AlertDescription>
          </Alert>
        ) : null}

        <Controller
          name="name"
          control={form.control}
          render={({ field, fieldState }) => (
            <Field data-invalid={fieldState.invalid}>
              <FieldLabel htmlFor="novo-lead-nome">Nome</FieldLabel>
              <Input
                {...field}
                id="novo-lead-nome"
                autoComplete="off"
                maxLength={LEAD_NAME_MAX_LENGTH}
                aria-invalid={fieldState.invalid}
              />
              {fieldState.invalid ? <FieldError errors={[fieldState.error]} /> : null}
            </Field>
          )}
        />

        <div className="grid gap-5 sm:grid-cols-2">
          <Controller
            name="phone"
            control={form.control}
            render={({ field, fieldState }) => (
              <Field data-invalid={fieldState.invalid}>
                <FieldLabel htmlFor="novo-lead-telefone">Telefone / WhatsApp</FieldLabel>
                <Input
                  id="novo-lead-telefone"
                  ref={field.ref}
                  name={field.name}
                  value={field.value}
                  onBlur={field.onBlur}
                  onChange={(event) => field.onChange(maskPhoneInput(event.target.value))}
                  type="tel"
                  inputMode="tel"
                  autoComplete="off"
                  placeholder="(11) 98765-4321"
                  aria-invalid={fieldState.invalid}
                />
                {fieldState.invalid ? <FieldError errors={[fieldState.error]} /> : null}
              </Field>
            )}
          />
          <Controller
            name="email"
            control={form.control}
            render={({ field, fieldState }) => (
              <Field data-invalid={fieldState.invalid}>
                <FieldLabel htmlFor="novo-lead-email">E-mail</FieldLabel>
                <Input
                  {...field}
                  id="novo-lead-email"
                  type="email"
                  autoComplete="off"
                  aria-invalid={fieldState.invalid}
                />
                {fieldState.invalid ? <FieldError errors={[fieldState.error]} /> : null}
              </Field>
            )}
          />
        </div>

        <div className="grid gap-5 sm:grid-cols-2">
          <Controller
            name="source"
            control={form.control}
            render={({ field, fieldState }) => (
              <Field data-invalid={fieldState.invalid}>
                <FieldLabel htmlFor="novo-lead-origem">Origem</FieldLabel>
                <Select
                  items={SOURCE_ITEMS}
                  value={field.value}
                  onValueChange={(value) => {
                    const source = MANUAL_LEAD_SOURCES.find((item) => item === value)
                    if (source) field.onChange(source)
                  }}
                >
                  <SelectTrigger
                    id="novo-lead-origem"
                    className="w-full"
                    aria-invalid={fieldState.invalid}
                  >
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
          <Controller
            name="assignedTo"
            control={form.control}
            render={({ field, fieldState }) => (
              <Field data-invalid={fieldState.invalid}>
                <FieldLabel htmlFor="novo-lead-responsavel">Responsável</FieldLabel>
                <Select
                  items={assigneeItems}
                  value={field.value || null}
                  onValueChange={(value: string | null) => field.onChange(value ?? "")}
                >
                  <SelectTrigger
                    id="novo-lead-responsavel"
                    className="w-full"
                    aria-invalid={fieldState.invalid}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {assigneeItems.map((item) => (
                        <SelectItem key={item.value ?? "sem-responsavel"} value={item.value}>
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

        <Controller
          name="interest"
          control={form.control}
          render={({ field, fieldState }) => (
            <Field data-invalid={fieldState.invalid}>
              <FieldTitle id="novo-lead-interesse">Interesse (opcional)</FieldTitle>
              <ToggleGroup
                aria-labelledby="novo-lead-interesse"
                variant="outline"
                size="sm"
                className="flex-wrap"
                value={field.value ? [field.value] : []}
                onValueChange={(value: string[]) => field.onChange(value[0] ?? "")}
              >
                {LEAD_INTERESTS.map((interest) => (
                  <ToggleGroupItem key={interest} value={interest}>
                    {LEAD_INTEREST_LABELS[interest]}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
              {fieldState.invalid ? <FieldError errors={[fieldState.error]} /> : null}
            </Field>
          )}
        />

        <Controller
          name="property"
          control={form.control}
          render={({ field, fieldState }) => (
            <Field data-invalid={fieldState.invalid}>
              <FieldLabel htmlFor="novo-lead-imovel">Imóvel de interesse (opcional)</FieldLabel>
              <PropertyCombobox
                id="novo-lead-imovel"
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
          name="message"
          control={form.control}
          render={({ field, fieldState }) => (
            <Field data-invalid={fieldState.invalid}>
              <FieldLabel htmlFor="novo-lead-mensagem">Mensagem (opcional)</FieldLabel>
              <Textarea
                {...field}
                id="novo-lead-mensagem"
                rows={3}
                maxLength={LEAD_MESSAGE_MAX_LENGTH}
                placeholder="O que o contato procura, melhor horário para retorno…"
                aria-invalid={fieldState.invalid}
              />
              {fieldState.invalid ? <FieldError errors={[fieldState.error]} /> : null}
            </Field>
          )}
        />

        <Controller
          name="hasConsent"
          control={form.control}
          render={({ field }) => (
            <Field orientation="horizontal">
              <Checkbox
                id="novo-lead-consentimento"
                name={field.name}
                checked={field.value}
                onCheckedChange={(checked) => {
                  const value = checked === true
                  field.onChange(value)
                  if (value && !form.getValues("consentDate")) {
                    form.setValue("consentDate", toDateKey(new Date()))
                  }
                }}
                onBlur={field.onBlur}
              />
              <FieldContent>
                <FieldLabel htmlFor="novo-lead-consentimento" className="font-normal">
                  O contato já autorizou o uso dos dados (consentimento, LGPD)
                </FieldLabel>
              </FieldContent>
            </Field>
          )}
        />

        {hasConsent ? (
          <Controller
            name="consentDate"
            control={form.control}
            render={({ field, fieldState }) => (
              <Field data-invalid={fieldState.invalid}>
                <FieldLabel htmlFor="novo-lead-data-consentimento">
                  Data do consentimento
                </FieldLabel>
                <DatePicker
                  id="novo-lead-data-consentimento"
                  value={field.value}
                  onChange={field.onChange}
                  onBlur={field.onBlur}
                  invalid={fieldState.invalid}
                />
                {fieldState.invalid ? (
                  <FieldError errors={[fieldState.error]} />
                ) : (
                  <FieldDescription>
                    Dia em que o contato autorizou o uso dos dados.
                  </FieldDescription>
                )}
              </Field>
            )}
          />
        ) : (
          <Alert>
            <InfoIcon />
            <AlertTitle>LGPD: base legal na conversão</AlertTitle>
            <AlertDescription>
              Sem consentimento marcado agora, escolha a base legal ao converter o lead em cliente —
              inclusive consentimento, com a data em que foi dado.
            </AlertDescription>
          </Alert>
        )}
      </FieldGroup>

      <DialogFooter>
        <DialogClose render={<Button type="button" variant="outline" />}>Cancelar</DialogClose>
        <Button type="submit" disabled={isSaving || !canCreate}>
          {isSaving ? <Spinner data-icon="inline-start" /> : null}
          Cadastrar lead
        </Button>
      </DialogFooter>
    </form>
  )
}

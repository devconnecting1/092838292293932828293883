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
} from "@workspace/ui/components/dialog"
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@workspace/ui/components/field"
import { Input } from "@workspace/ui/components/input"
import { Spinner } from "@workspace/ui/components/spinner"
import { Textarea } from "@workspace/ui/components/textarea"
import { toast } from "@workspace/ui/components/toast"

import { OptionCombobox, type ComboboxOption } from "@/components/propostas/option-combobox"
import { createKey, updateKey } from "@/lib/chaves/actions"
import { keyCreateSchema, type KeyCreateValues } from "@/lib/chaves/schemas"
import { FormDraftNotice } from "@/lib/forms/draft/form-draft-notice"
import { useFormDraft } from "@/lib/forms/draft/use-form-draft"
import { useFormDraftScope } from "@/lib/forms/draft/use-form-draft-scope"
import { useGuardedSubmit } from "@/lib/forms/submit/use-guarded-submit"
import { UnsavedChangesGuard } from "@/lib/forms/unsaved/unsaved-changes-guard"

export type EditableKey = {
  id: string
  propertyId: string
  propertyLabel: string
  label: string
  location: string | null
  notes: string | null
}

type KeyFormProps = {
  /** Imóveis que o usuário pode editar (cadastro). */
  properties: ComboboxOption[]
  /** Presente = edição. */
  editingKey?: EditableKey | null
  defaultPropertyId?: string
}

type KeyFormDialogProps = KeyFormProps & {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function KeyFormDialog({ open, onOpenChange, ...formProps }: KeyFormDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        {/* O conteúdo monta a cada abertura: o formulário sempre começa limpo. */}
        <KeyForm
          key={formProps.editingKey?.id ?? "nova-chave"}
          {...formProps}
          onDone={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  )
}

function KeyForm({
  properties,
  editingKey,
  defaultPropertyId,
  onDone,
}: KeyFormProps & { onDone: () => void }) {
  const { isPending: isSubmitting, run: runSubmit } = useGuardedSubmit()
  const [formError, setFormError] = React.useState<string | null>(null)
  const isEditing = Boolean(editingKey)

  const form = useForm<KeyCreateValues>({
    resolver: zodResolver(keyCreateSchema),
    mode: "onTouched",
    defaultValues: editingKey
      ? {
          propertyId: editingKey.propertyId,
          label: editingKey.label,
          location: editingKey.location ?? "",
          notes: editingKey.notes ?? "",
        }
      : {
          propertyId: defaultPropertyId ?? "",
          label: "",
          location: "",
          notes: "",
        },
  })
  const { isDirty } = form.formState

  // Internet caiu ou o diálogo fechou sem querer: o cadastro da chave volta na próxima abertura.
  const draftScope = useFormDraftScope()
  const draft = useFormDraft({
    form,
    scope: draftScope,
    formId: "chave",
    recordId: editingKey?.id ?? null,
    // Na edição o imóvel não muda: vem sempre do registro.
    exclude: editingKey ? ["propertyId"] : undefined,
  })

  const propertyOptions = React.useMemo(
    () =>
      editingKey && !properties.some((option) => option.value === editingKey.propertyId)
        ? [...properties, { value: editingKey.propertyId, label: editingKey.propertyLabel }]
        : properties,
    [properties, editingKey]
  )

  function onSubmit(values: KeyCreateValues) {
    setFormError(null)

    runSubmit(
      async () => {
        const result = editingKey
          ? await updateKey(editingKey.id, {
              label: values.label,
              location: values.location,
              notes: values.notes,
            })
          : await createKey(values)

        if (!result.ok) {
          setFormError(result.error)
          return
        }

        draft.clear()
        toast.add({ title: result.message ?? "Chave salva.", type: "success" })
        onDone()
      },
      ({ message }) => {
        // Queda de rede ou erro inesperado: o diálogo continua aberto com os campos.
        draft.saveNow()
        setFormError(message)
      }
    )
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>{isEditing ? "Editar chave" : "Cadastrar chave"}</DialogTitle>
        <DialogDescription>
          {isEditing
            ? "Atualize o rótulo, o local onde a chave fica guardada e as observações."
            : "Registre uma chave do imóvel e onde ela fica guardada."}
        </DialogDescription>
      </DialogHeader>
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
          <Controller
            name="propertyId"
            control={form.control}
            render={({ field, fieldState }) => (
              <Field data-invalid={fieldState.invalid} data-disabled={isEditing || undefined}>
                <FieldLabel htmlFor="chave-imovel">Imóvel</FieldLabel>
                <OptionCombobox
                  id="chave-imovel"
                  options={propertyOptions}
                  value={field.value}
                  onValueChange={field.onChange}
                  onBlur={field.onBlur}
                  placeholder="Buscar por código ou título"
                  emptyText="Nenhum imóvel que você possa editar."
                  disabled={isEditing}
                  invalid={fieldState.invalid}
                />
                {fieldState.invalid ? (
                  <FieldError errors={[fieldState.error]} />
                ) : isEditing ? (
                  <FieldDescription>O imóvel de uma chave não pode ser trocado.</FieldDescription>
                ) : null}
              </Field>
            )}
          />
          <Controller
            name="label"
            control={form.control}
            render={({ field, fieldState }) => (
              <Field data-invalid={fieldState.invalid}>
                <FieldLabel htmlFor="chave-rotulo">Rótulo</FieldLabel>
                <Input
                  {...field}
                  id="chave-rotulo"
                  placeholder="Ex.: Porta principal, Portão, Chaveiro 12"
                  maxLength={60}
                  aria-invalid={fieldState.invalid}
                />
                {fieldState.invalid ? <FieldError errors={[fieldState.error]} /> : null}
              </Field>
            )}
          />
          <Controller
            name="location"
            control={form.control}
            render={({ field, fieldState }) => (
              <Field data-invalid={fieldState.invalid}>
                <FieldLabel htmlFor="chave-local">Local (opcional)</FieldLabel>
                <Input
                  {...field}
                  id="chave-local"
                  placeholder="Ex.: Quadro da recepção, gaveta 3"
                  maxLength={200}
                  aria-invalid={fieldState.invalid}
                />
                {fieldState.invalid ? <FieldError errors={[fieldState.error]} /> : null}
              </Field>
            )}
          />
          <Controller
            name="notes"
            control={form.control}
            render={({ field, fieldState }) => (
              <Field data-invalid={fieldState.invalid}>
                <FieldLabel htmlFor="chave-observacoes">Observações (opcional)</FieldLabel>
                <Textarea
                  {...field}
                  id="chave-observacoes"
                  rows={3}
                  maxLength={2000}
                  aria-invalid={fieldState.invalid}
                />
                {fieldState.invalid ? <FieldError errors={[fieldState.error]} /> : null}
              </Field>
            )}
          />
        </FieldGroup>
        <DialogFooter>
          <DialogClose render={<Button type="button" variant="outline" />}>Cancelar</DialogClose>
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? <Spinner data-icon="inline-start" /> : null}
            {isEditing ? "Salvar alterações" : "Cadastrar chave"}
          </Button>
        </DialogFooter>
      </form>
    </>
  )
}

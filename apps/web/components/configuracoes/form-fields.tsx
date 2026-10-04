import type * as React from "react"
import { Controller, type Control, type FieldPath, type FieldValues } from "react-hook-form"

import { BRAZILIAN_STATES } from "@workspace/core/br/states"
import { Field, FieldDescription, FieldError, FieldLabel } from "@workspace/ui/components/field"
import { Input } from "@workspace/ui/components/input"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select"

// Campos controlados reutilizados pelos formulários de configurações e perfil.
// Usados só dentro de Client Components (recebem funções como props).

type FormTextFieldProps<T extends FieldValues> = {
  control: Control<T>
  name: FieldPath<T>
  id: string
  label: string
  description?: React.ReactNode
  /** Máscara aplicada a cada digitação. */
  mask?: (value: string) => string
} & Omit<
  React.ComponentProps<"input">,
  "name" | "id" | "value" | "defaultValue" | "onChange" | "onBlur" | "ref"
>

export function FormTextField<T extends FieldValues>({
  control,
  name,
  id,
  label,
  description,
  mask,
  ...inputProps
}: FormTextFieldProps<T>) {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => (
        <Field data-invalid={fieldState.invalid}>
          <FieldLabel htmlFor={id}>{label}</FieldLabel>
          <Input
            {...inputProps}
            id={id}
            name={field.name}
            ref={field.ref}
            value={(field.value as string | undefined) ?? ""}
            onBlur={field.onBlur}
            onChange={(event) =>
              field.onChange(mask ? mask(event.target.value) : event.target.value)
            }
            aria-invalid={fieldState.invalid}
          />
          {fieldState.invalid ? (
            <FieldError errors={[fieldState.error]} />
          ) : description ? (
            <FieldDescription>{description}</FieldDescription>
          ) : null}
        </Field>
      )}
    />
  )
}

const STATE_OPTIONS = BRAZILIAN_STATES.map((state) => ({
  label: `${state.code} · ${state.name}`,
  value: state.code as string | null,
}))

type FormStateSelectProps<T extends FieldValues> = {
  control: Control<T>
  name: FieldPath<T>
  id: string
  label: string
  description?: React.ReactNode
  disabled?: boolean
  /** Mostra a opção "Sem UF" para campos opcionais. */
  allowEmpty?: boolean
}

export function FormStateSelect<T extends FieldValues>({
  control,
  name,
  id,
  label,
  description,
  disabled,
  allowEmpty = false,
}: FormStateSelectProps<T>) {
  const items = [{ label: allowEmpty ? "Sem UF" : "Selecione", value: null }, ...STATE_OPTIONS]
  const listed = allowEmpty ? items : STATE_OPTIONS

  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => (
        <Field data-invalid={fieldState.invalid}>
          <FieldLabel htmlFor={id}>{label}</FieldLabel>
          <Select
            items={items}
            value={(field.value as string | undefined) || null}
            onValueChange={(value) => field.onChange(value ?? "")}
            onOpenChange={(open) => {
              if (!open) field.onBlur()
            }}
            disabled={disabled}
          >
            <SelectTrigger id={id} className="w-full" aria-invalid={fieldState.invalid}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {listed.map((item) => (
                  <SelectItem key={item.value ?? "vazio"} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
          {fieldState.invalid ? (
            <FieldError errors={[fieldState.error]} />
          ) : description ? (
            <FieldDescription>{description}</FieldDescription>
          ) : null}
        </Field>
      )}
    />
  )
}

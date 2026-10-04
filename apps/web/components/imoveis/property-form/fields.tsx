"use client"

import * as React from "react"
import { Controller, type Control, type FieldPathByValue } from "react-hook-form"

import { Checkbox } from "@workspace/ui/components/checkbox"
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
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

import { MoneyInput } from "@/components/imoveis/money-input"
import type { PropertyFormValues } from "@/lib/imoveis/schema"

export type PropertyFormControl = Control<PropertyFormValues>
export type StringFieldName = FieldPathByValue<PropertyFormValues, string>
export type BooleanFieldName = FieldPathByValue<PropertyFormValues, boolean>

export type SelectOption = { label: string; value: string | null }

export function fieldId(name: string) {
  return `imovel-${name}`
}

function Feedback({
  error,
  description,
}: {
  error?: { message?: string }
  description?: React.ReactNode
}) {
  if (error) return <FieldError errors={[error]} />
  return description ? <FieldDescription>{description}</FieldDescription> : null
}

export function TextField({
  control,
  name,
  label,
  description,
  disabled,
  ...inputProps
}: {
  control: PropertyFormControl
  name: StringFieldName
  label: React.ReactNode
  description?: React.ReactNode
  disabled?: boolean
} & Pick<
  React.ComponentProps<"input">,
  "placeholder" | "inputMode" | "maxLength" | "autoComplete" | "type"
>) {
  return (
    <Controller
      name={name}
      control={control}
      render={({ field, fieldState }) => (
        <Field data-invalid={fieldState.invalid || undefined} data-disabled={disabled || undefined}>
          <FieldLabel htmlFor={fieldId(name)}>{label}</FieldLabel>
          <Input
            {...inputProps}
            id={fieldId(name)}
            name={field.name}
            ref={field.ref}
            value={field.value}
            onChange={field.onChange}
            onBlur={field.onBlur}
            disabled={disabled}
            aria-invalid={fieldState.invalid}
          />
          <Feedback error={fieldState.error} description={description} />
        </Field>
      )}
    />
  )
}

export function SelectField({
  control,
  name,
  label,
  description,
  items,
  disabled,
}: {
  control: PropertyFormControl
  name: StringFieldName
  label: React.ReactNode
  description?: React.ReactNode
  items: readonly SelectOption[]
  disabled?: boolean
}) {
  return (
    <Controller
      name={name}
      control={control}
      render={({ field, fieldState }) => (
        <Field data-invalid={fieldState.invalid || undefined} data-disabled={disabled || undefined}>
          <FieldLabel htmlFor={fieldId(name)}>{label}</FieldLabel>
          <Select
            items={items}
            value={field.value ? field.value : null}
            onValueChange={(value) => field.onChange(value ?? "")}
            onOpenChange={(open) => {
              if (!open) field.onBlur()
            }}
            disabled={disabled}
          >
            <SelectTrigger id={fieldId(name)} className="w-full" aria-invalid={fieldState.invalid}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {items.map((item) => (
                  <SelectItem key={item.value ?? "vazio"} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
          <Feedback error={fieldState.error} description={description} />
        </Field>
      )}
    />
  )
}

export function MoneyField({
  control,
  name,
  label,
  description,
  suffix,
  disabled,
}: {
  control: PropertyFormControl
  name: StringFieldName
  label: React.ReactNode
  description?: React.ReactNode
  suffix?: string
  disabled?: boolean
}) {
  return (
    <Controller
      name={name}
      control={control}
      render={({ field, fieldState }) => (
        <Field data-invalid={fieldState.invalid || undefined} data-disabled={disabled || undefined}>
          <FieldLabel htmlFor={fieldId(name)}>{label}</FieldLabel>
          <MoneyInput
            id={fieldId(name)}
            name={field.name}
            ref={field.ref}
            value={field.value}
            onValueChange={field.onChange}
            onBlur={field.onBlur}
            suffix={suffix}
            disabled={disabled}
            aria-invalid={fieldState.invalid}
          />
          <Feedback error={fieldState.error} description={description} />
        </Field>
      )}
    />
  )
}

export function CheckboxField({
  control,
  name,
  label,
  description,
  disabled,
}: {
  control: PropertyFormControl
  name: BooleanFieldName
  label: React.ReactNode
  description?: React.ReactNode
  disabled?: boolean
}) {
  return (
    <Controller
      name={name}
      control={control}
      render={({ field }) => (
        <Field orientation="horizontal" data-disabled={disabled || undefined}>
          <Checkbox
            id={fieldId(name)}
            checked={field.value}
            onCheckedChange={(checked) => field.onChange(checked === true)}
            disabled={disabled}
          />
          <FieldContent>
            <FieldLabel htmlFor={fieldId(name)} className="font-normal">
              {label}
            </FieldLabel>
            {description ? <FieldDescription>{description}</FieldDescription> : null}
          </FieldContent>
        </Field>
      )}
    />
  )
}

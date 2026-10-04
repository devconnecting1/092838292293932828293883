"use client"

import type * as React from "react"
import { Controller, type Control, type FieldPath, type FieldValues } from "react-hook-form"

import { Field, FieldDescription, FieldError, FieldLabel } from "@workspace/ui/components/field"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
} from "@workspace/ui/components/input-group"

import { maskBrlInput } from "@/lib/comissoes/money"

// Campos controlados dos formulários de comissão. Percentual aceita até três
// casas (a mesma precisão de numeric(6,3) no banco); dinheiro é digitado em
// centavos e mascarado.

type PercentFieldProps<T extends FieldValues> = {
  control: Control<T>
  name: FieldPath<T>
  id: string
  label: string
  description?: React.ReactNode
  disabled?: boolean
}

export function PercentField<T extends FieldValues>({
  control,
  name,
  id,
  label,
  description,
  disabled,
}: PercentFieldProps<T>) {
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
              inputMode="decimal"
              min={0}
              max={100}
              step={0.001}
              disabled={disabled}
              value={Number.isFinite(field.value as number) ? String(field.value) : ""}
              onBlur={field.onBlur}
              onChange={(event) =>
                field.onChange(event.target.value === "" ? Number.NaN : event.target.valueAsNumber)
              }
              aria-invalid={fieldState.invalid}
            />
            <InputGroupAddon align="inline-end">
              <InputGroupText>%</InputGroupText>
            </InputGroupAddon>
          </InputGroup>
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

type MoneyFieldProps<T extends FieldValues> = {
  control: Control<T>
  name: FieldPath<T>
  id: string
  label: string
  description?: React.ReactNode
  disabled?: boolean
}

export function MoneyField<T extends FieldValues>({
  control,
  name,
  id,
  label,
  description,
  disabled,
}: MoneyFieldProps<T>) {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => (
        <Field data-invalid={fieldState.invalid}>
          <FieldLabel htmlFor={id}>{label}</FieldLabel>
          <InputGroup>
            <InputGroupAddon align="inline-start">
              <InputGroupText>R$</InputGroupText>
            </InputGroupAddon>
            <InputGroupInput
              id={id}
              name={field.name}
              ref={field.ref}
              inputMode="numeric"
              autoComplete="off"
              placeholder="0,00"
              disabled={disabled}
              value={(field.value as string | undefined) ?? ""}
              onBlur={field.onBlur}
              onChange={(event) => field.onChange(maskBrlInput(event.target.value))}
              aria-invalid={fieldState.invalid}
            />
          </InputGroup>
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

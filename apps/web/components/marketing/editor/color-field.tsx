"use client"

import { XIcon } from "lucide-react"

import { Field, FieldDescription, FieldError, FieldLabel } from "@workspace/ui/components/field"
import { Input } from "@workspace/ui/components/input"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@workspace/ui/components/input-group"

import { LANDING_HEX_COLOR_PATTERN } from "@/lib/landing/types"

/**
 * Cor da marca: seletor nativo + campo hexadecimal. Vazio = a cor é derivada
 * (da marca da imobiliária ou da cor primária), mostrada no seletor.
 */
export function ColorField({
  id,
  label,
  value,
  resolvedColor,
  description,
  warning,
  error,
  disabled,
  onChange,
  onBlur,
}: {
  id: string
  label: string
  value: string
  /** Cor efetiva quando o campo está vazio (derivada). */
  resolvedColor: string
  description: string
  /** Aviso de contraste (a cor será ajustada no texto/botões). */
  warning?: string | null
  error?: string
  disabled?: boolean
  onChange: (value: string) => void
  onBlur?: () => void
}) {
  const isValid = LANDING_HEX_COLOR_PATTERN.test(value)
  const pickerValue = isValid ? value : resolvedColor

  return (
    <Field data-invalid={Boolean(error)} data-disabled={disabled || undefined}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <div className="flex items-center gap-2">
        <Input
          type="color"
          aria-label={`Escolher ${label.toLowerCase()}`}
          className="w-12 shrink-0 p-1"
          value={pickerValue.toLowerCase()}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value.toUpperCase())}
          onBlur={onBlur}
        />
        <InputGroup>
          <InputGroupInput
            id={id}
            value={value}
            placeholder={resolvedColor}
            maxLength={7}
            spellCheck={false}
            autoComplete="off"
            disabled={disabled}
            aria-invalid={Boolean(error) || undefined}
            onChange={(event) => {
              const next = event.target.value.trim().toUpperCase()
              onChange(next && !next.startsWith("#") ? `#${next}` : next)
            }}
            onBlur={onBlur}
          />
          {value && !disabled ? (
            <InputGroupAddon align="inline-end">
              <InputGroupButton size="icon-xs" onClick={() => onChange("")}>
                <XIcon />
                <span className="sr-only">Limpar {label.toLowerCase()}</span>
              </InputGroupButton>
            </InputGroupAddon>
          ) : null}
        </InputGroup>
      </div>
      {error ? (
        <FieldError>{error}</FieldError>
      ) : (
        <FieldDescription>{warning ?? description}</FieldDescription>
      )}
    </Field>
  )
}

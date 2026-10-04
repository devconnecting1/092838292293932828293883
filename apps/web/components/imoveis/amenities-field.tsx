"use client"

import * as React from "react"
import { PlusIcon, XIcon } from "lucide-react"

import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import { Checkbox } from "@workspace/ui/components/checkbox"
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@workspace/ui/components/field"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@workspace/ui/components/input-group"

import { isCatalogAmenity, normalizeAmenities, type AmenityOption } from "@/lib/imoveis/amenities"

type AmenitiesFieldProps = {
  id: string
  legend: string
  description?: string
  options: readonly AmenityOption[]
  value: string[]
  onChange: (value: string[]) => void
  disabled?: boolean
}

/** Lista de comodidades comuns (checkboxes) + comodidades livres digitadas. */
export function AmenitiesField({
  id,
  legend,
  description,
  options,
  value,
  onChange,
  disabled,
}: AmenitiesFieldProps) {
  const [custom, setCustom] = React.useState("")
  const selected = new Set(value)
  const customValues = value.filter((item) => !isCatalogAmenity(item))

  function toggle(option: string, checked: boolean) {
    onChange(
      checked ? normalizeAmenities([...value, option]) : value.filter((item) => item !== option)
    )
  }

  function addCustom() {
    const text = custom.trim()
    if (!text) return
    onChange(normalizeAmenities([...value, ...text.split(/[,;]/)]))
    setCustom("")
  }

  return (
    <FieldSet>
      <FieldLegend variant="label">{legend}</FieldLegend>
      {description ? <FieldDescription>{description}</FieldDescription> : null}
      <FieldGroup className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {options.map((option) => {
          const checkboxId = `${id}-${option.value}`
          return (
            <Field
              key={option.value}
              orientation="horizontal"
              data-disabled={disabled || undefined}
            >
              <Checkbox
                id={checkboxId}
                checked={selected.has(option.value)}
                disabled={disabled}
                onCheckedChange={(checked) => toggle(option.value, checked === true)}
              />
              <FieldLabel htmlFor={checkboxId} className="font-normal">
                {option.label}
              </FieldLabel>
            </Field>
          )
        })}
      </FieldGroup>
      <Field>
        <FieldLabel htmlFor={`${id}-outras`}>Outras</FieldLabel>
        <InputGroup>
          <InputGroupInput
            id={`${id}-outras`}
            value={custom}
            disabled={disabled}
            maxLength={120}
            placeholder="Ex.: Vista para o mar, Adega"
            onChange={(event) => setCustom(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault()
                addCustom()
              }
            }}
          />
          <InputGroupAddon align="inline-end">
            <InputGroupButton onClick={addCustom} disabled={disabled || !custom.trim()}>
              <PlusIcon data-icon="inline-start" />
              Adicionar
            </InputGroupButton>
          </InputGroupAddon>
        </InputGroup>
        {customValues.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {customValues.map((item) => (
              <Badge key={item} variant="secondary">
                {item}
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  disabled={disabled}
                  onClick={() => onChange(value.filter((current) => current !== item))}
                >
                  <XIcon />
                  <span className="sr-only">Remover {item}</span>
                </Button>
              </Badge>
            ))}
          </div>
        ) : (
          <FieldDescription>Separe várias por vírgula.</FieldDescription>
        )}
      </Field>
    </FieldSet>
  )
}

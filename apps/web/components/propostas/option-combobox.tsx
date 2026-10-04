"use client"

import * as React from "react"

import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@workspace/ui/components/combobox"

export type ComboboxOption = {
  value: string
  label: string
  description?: string
}

type OptionComboboxProps = {
  id?: string
  options: ComboboxOption[]
  /** Valor selecionado ("" = nenhum). */
  value: string
  onValueChange: (value: string) => void
  onBlur?: () => void
  placeholder?: string
  emptyText?: string
  disabled?: boolean
  invalid?: boolean
}

/** Combobox com busca para listas de imóveis, clientes e membros da equipe. */
export function OptionCombobox({
  id,
  options,
  value,
  onValueChange,
  onBlur,
  placeholder = "Buscar…",
  emptyText = "Nenhum resultado.",
  disabled = false,
  invalid = false,
}: OptionComboboxProps) {
  const selected = React.useMemo(
    () => options.find((option) => option.value === value) ?? null,
    [options, value]
  )

  return (
    <Combobox
      items={options}
      value={selected}
      onValueChange={(option: ComboboxOption | null) => onValueChange(option?.value ?? "")}
      itemToStringLabel={(option: ComboboxOption) => option.label}
      isItemEqualToValue={(option: ComboboxOption, current: ComboboxOption) =>
        option.value === current.value
      }
      onOpenChange={(open) => {
        if (!open) onBlur?.()
      }}
      disabled={disabled}
    >
      <ComboboxInput
        id={id}
        className="w-full"
        placeholder={placeholder}
        aria-invalid={invalid || undefined}
        disabled={disabled}
        showClear={selected !== null && !disabled}
      />
      <ComboboxContent>
        <ComboboxEmpty>{emptyText}</ComboboxEmpty>
        <ComboboxList>
          {(option: ComboboxOption) => (
            <ComboboxItem key={option.value} value={option}>
              <span className="flex min-w-0 flex-col">
                <span className="truncate">{option.label}</span>
                {option.description ? (
                  <span className="truncate text-xs text-muted-foreground">
                    {option.description}
                  </span>
                ) : null}
              </span>
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  )
}

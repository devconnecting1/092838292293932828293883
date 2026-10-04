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
import { Item, ItemContent, ItemDescription, ItemTitle } from "@workspace/ui/components/item"

import type { EntityOption } from "@/lib/clientes/options"

const SEARCH_DEBOUNCE_MS = 250

export type AsyncEntityComboboxProps = {
  id?: string
  value: EntityOption | null
  onValueChange: (value: EntityOption | null) => void
  /** Server Action de busca; recebe o texto digitado ("" ao abrir). */
  search: (query: string) => Promise<EntityOption[]>
  placeholder?: string
  emptyMessage?: string
  disabled?: boolean
  invalid?: boolean
  onBlur?: () => void
}

/**
 * Combobox com busca no servidor: a filtragem local fica desligada
 * (filter={null}) e a lista mostra só o resultado da última busca.
 */
export function AsyncEntityCombobox({
  id,
  value,
  onValueChange,
  search,
  placeholder,
  emptyMessage = "Nada encontrado.",
  disabled,
  invalid,
  onBlur,
}: AsyncEntityComboboxProps) {
  const [results, setResults] = React.useState<EntityOption[]>([])
  const [hasSearched, setHasSearched] = React.useState(false)
  const [isSearching, startSearch] = React.useTransition()
  const requestIdRef = React.useRef(0)
  const timeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)

  React.useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current)
    }
  }, [])

  function scheduleSearch(query: string, delay = SEARCH_DEBOUNCE_MS) {
    if (timeoutRef.current) clearTimeout(timeoutRef.current)

    const requestId = ++requestIdRef.current

    timeoutRef.current = setTimeout(() => {
      startSearch(async () => {
        const options = await search(query)

        if (requestId === requestIdRef.current) {
          setResults(options)
          setHasSearched(true)
        }
      })
    }, delay)
  }

  // O item selecionado precisa estar na coleção para o rótulo aparecer.
  const items =
    value && !results.some((option) => option.id === value.id) ? [value, ...results] : results

  return (
    <Combobox
      items={items}
      filter={null}
      value={value}
      onValueChange={(next: EntityOption | null) => onValueChange(next)}
      itemToStringLabel={(option: EntityOption) => option.label}
      itemToStringValue={(option: EntityOption) => option.id}
      isItemEqualToValue={(option: EntityOption, selected: EntityOption) =>
        option.id === selected.id
      }
      onOpenChange={(open) => {
        if (open && !hasSearched) scheduleSearch("", 0)
        if (!open) onBlur?.()
      }}
      onInputValueChange={(inputValue, details) => {
        if (details.reason === "input-change" || details.reason === "input-clear") {
          scheduleSearch(inputValue)
        }
      }}
      disabled={disabled}
    >
      <ComboboxInput
        id={id}
        className="w-full"
        placeholder={placeholder}
        disabled={disabled}
        aria-invalid={invalid || undefined}
        showClear={Boolean(value) && !disabled}
      />
      <ComboboxContent>
        <ComboboxEmpty>{isSearching || !hasSearched ? "Buscando…" : emptyMessage}</ComboboxEmpty>
        <ComboboxList>
          {(option: EntityOption) => (
            <ComboboxItem key={option.id} value={option}>
              <Item size="xs" className="p-0">
                <ItemContent>
                  <ItemTitle className="whitespace-nowrap">{option.label}</ItemTitle>
                  {option.description ? (
                    <ItemDescription>{option.description}</ItemDescription>
                  ) : null}
                </ItemContent>
              </Item>
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  )
}

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

import type { OwnerClientOption } from "@/components/imoveis/detail/types"
import { searchClientsForOwnerAction } from "@/lib/imoveis/owner-actions"

const SEARCH_DEBOUNCE_MS = 250

/**
 * Combobox de clientes com busca no servidor (filtro local desligado). Os
 * clientes que já são proprietários do imóvel ficam fora da lista.
 */
export function OwnerClientCombobox({
  id,
  value,
  onValueChange,
  excludeIds,
  invalid,
  disabled,
  onBlur,
}: {
  id?: string
  value: OwnerClientOption | null
  onValueChange: (value: OwnerClientOption | null) => void
  excludeIds: readonly string[]
  invalid?: boolean
  disabled?: boolean
  onBlur?: () => void
}) {
  const [results, setResults] = React.useState<OwnerClientOption[]>([])
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
        const options = await searchClientsForOwnerAction(query)
        if (requestId === requestIdRef.current) {
          setResults(options)
          setHasSearched(true)
        }
      })
    }, delay)
  }

  const available = results.filter((option) => !excludeIds.includes(option.id))
  // O item selecionado precisa estar na coleção para o rótulo aparecer.
  const items =
    value && !available.some((option) => option.id === value.id) ? [value, ...available] : available

  return (
    <Combobox
      items={items}
      filter={null}
      value={value}
      onValueChange={(next: OwnerClientOption | null) => onValueChange(next)}
      itemToStringLabel={(option: OwnerClientOption) => option.label}
      itemToStringValue={(option: OwnerClientOption) => option.id}
      isItemEqualToValue={(option: OwnerClientOption, selected: OwnerClientOption) =>
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
        placeholder="Buscar cliente pelo nome"
        disabled={disabled}
        aria-invalid={invalid || undefined}
        showClear={Boolean(value) && !disabled}
      />
      <ComboboxContent>
        <ComboboxEmpty>
          {isSearching || !hasSearched ? "Buscando…" : "Nenhum cliente encontrado."}
        </ComboboxEmpty>
        <ComboboxList>
          {(option: OwnerClientOption) => (
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

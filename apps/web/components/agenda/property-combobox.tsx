"use client"

import {
  AsyncEntityCombobox,
  type AsyncEntityComboboxProps,
} from "@/components/clientes/async-entity-combobox"
import { searchPropertyOptions } from "@/lib/agenda/search-actions"

type PropertyComboboxProps = Omit<AsyncEntityComboboxProps, "search" | "emptyMessage">

/** Combobox de imóveis com busca no servidor por código, título ou bairro. */
export function PropertyCombobox({
  placeholder = "Buscar imóvel por código ou título",
  ...props
}: PropertyComboboxProps) {
  return (
    <AsyncEntityCombobox
      {...props}
      placeholder={placeholder}
      search={searchPropertyOptions}
      emptyMessage="Nenhum imóvel encontrado."
    />
  )
}

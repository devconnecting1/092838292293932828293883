"use client"

import {
  AsyncEntityCombobox,
  type AsyncEntityComboboxProps,
} from "@/components/clientes/async-entity-combobox"
import { searchClientOptions } from "@/lib/clientes/search-actions"

type ClientComboboxProps = Omit<AsyncEntityComboboxProps, "search" | "emptyMessage">

/** Combobox de clientes com busca no servidor (respeita o RLS do usuário). */
export function ClientCombobox({
  placeholder = "Buscar cliente por nome, e-mail ou telefone",
  ...props
}: ClientComboboxProps) {
  return (
    <AsyncEntityCombobox
      {...props}
      placeholder={placeholder}
      search={searchClientOptions}
      emptyMessage="Nenhum cliente encontrado."
    />
  )
}

"use client"

import { XIcon } from "lucide-react"

import { Button } from "@workspace/ui/components/button"
import { Field, FieldGroup, FieldLabel } from "@workspace/ui/components/field"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select"
import { Spinner } from "@workspace/ui/components/spinner"

import { OptionCombobox, type ComboboxOption } from "@/components/propostas/option-combobox"
import { useFilterParams } from "@/components/propostas/use-filter-params"

type SelectEntry = { label: string; value: string | null }

const PURPOSE_ITEMS: SelectEntry[] = [
  { label: "Venda e locação", value: null },
  { label: "Venda", value: "sale" },
  { label: "Locação", value: "rent" },
]

function validValue(items: SelectEntry[], value: string | null) {
  return items.some((item) => item.value === value) ? value : null
}

export function ProposalsFilters({
  properties,
  brokers,
}: {
  properties: ComboboxOption[]
  brokers: ComboboxOption[]
}) {
  const { searchParams, setParams, isPending } = useFilterParams()

  const brokerItems: SelectEntry[] = [
    { label: "Todos os corretores", value: null },
    ...brokers.map((broker) => ({ label: broker.label, value: broker.value })),
  ]

  const propertyId = searchParams.get("imovel") ?? ""
  const brokerId = validValue(brokerItems, searchParams.get("corretor"))
  const purpose = validValue(PURPOSE_ITEMS, searchParams.get("finalidade"))
  const hasFilters = Boolean(propertyId || brokerId || purpose)

  return (
    <FieldGroup className="gap-3 md:flex-row md:flex-wrap md:items-end">
      <Field className="md:w-80">
        <FieldLabel htmlFor="propostas-filtro-imovel">Imóvel</FieldLabel>
        <OptionCombobox
          id="propostas-filtro-imovel"
          options={properties}
          value={propertyId}
          onValueChange={(value) => setParams({ imovel: value || null })}
          placeholder="Todos os imóveis"
          emptyText="Nenhum imóvel encontrado."
        />
      </Field>
      <Field className="md:w-56">
        <FieldLabel htmlFor="propostas-filtro-corretor">Corretor</FieldLabel>
        <Select
          items={brokerItems}
          value={brokerId}
          onValueChange={(value: string | null) => setParams({ corretor: value })}
        >
          <SelectTrigger id="propostas-filtro-corretor" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {brokerItems.map((item) => (
                <SelectItem key={item.value ?? "todos"} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      </Field>
      <Field className="md:w-44">
        <FieldLabel htmlFor="propostas-filtro-finalidade">Finalidade</FieldLabel>
        <Select
          items={PURPOSE_ITEMS}
          value={purpose}
          onValueChange={(value: string | null) => setParams({ finalidade: value })}
        >
          <SelectTrigger id="propostas-filtro-finalidade" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {PURPOSE_ITEMS.map((item) => (
                <SelectItem key={item.value ?? "todas"} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      </Field>
      {hasFilters ? (
        <Button
          variant="ghost"
          className="md:w-auto"
          onClick={() => setParams({ imovel: null, corretor: null, finalidade: null })}
        >
          <XIcon data-icon="inline-start" />
          Limpar filtros
        </Button>
      ) : null}
      {isPending ? <Spinner className="self-center" aria-label="Atualizando a lista" /> : null}
    </FieldGroup>
  )
}

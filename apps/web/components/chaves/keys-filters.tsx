"use client"

import { XIcon } from "lucide-react"

import { KEY_STATUS_LABELS, KEY_STATUS_VALUES } from "@workspace/core/properties/enums"
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
import { Switch } from "@workspace/ui/components/switch"

import { OptionCombobox, type ComboboxOption } from "@/components/propostas/option-combobox"
import { useFilterParams } from "@/components/propostas/use-filter-params"

const STATUS_ITEMS: { label: string; value: string | null }[] = [
  { label: "Todos os status", value: null },
  ...KEY_STATUS_VALUES.map((status) => ({
    label: KEY_STATUS_LABELS[status],
    value: status,
  })),
]

export function KeysFilters({ properties }: { properties: ComboboxOption[] }) {
  const { searchParams, setParams, isPending } = useFilterParams()

  const statusParam = searchParams.get("status")
  const status = STATUS_ITEMS.some((item) => item.value === statusParam) ? statusParam : null
  const propertyId = searchParams.get("imovel") ?? ""
  const overdue = searchParams.get("vencidas") === "1"
  const hasFilters = Boolean(status || propertyId || overdue)

  return (
    <FieldGroup className="gap-3 md:flex-row md:flex-wrap md:items-end">
      <Field className="md:w-48">
        <FieldLabel htmlFor="chaves-filtro-status">Status</FieldLabel>
        <Select
          items={STATUS_ITEMS}
          value={status}
          onValueChange={(value: string | null) => setParams({ status: value })}
        >
          <SelectTrigger id="chaves-filtro-status" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {STATUS_ITEMS.map((item) => (
                <SelectItem key={item.label} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      </Field>
      <Field className="md:w-80">
        <FieldLabel htmlFor="chaves-filtro-imovel">Imóvel</FieldLabel>
        <OptionCombobox
          id="chaves-filtro-imovel"
          options={properties}
          value={propertyId}
          onValueChange={(value) => setParams({ imovel: value || null })}
          placeholder="Todos os imóveis"
          emptyText="Nenhum imóvel encontrado."
        />
      </Field>
      <Field orientation="horizontal" className="md:h-8 md:w-auto">
        <Switch
          id="chaves-filtro-vencidas"
          checked={overdue}
          onCheckedChange={(checked) => setParams({ vencidas: checked ? "1" : null })}
        />
        <FieldLabel htmlFor="chaves-filtro-vencidas" className="font-normal">
          Só devoluções vencidas
        </FieldLabel>
      </Field>
      {hasFilters ? (
        <Button
          variant="ghost"
          className="md:w-auto"
          onClick={() => setParams({ status: null, imovel: null, vencidas: null })}
        >
          <XIcon data-icon="inline-start" />
          Limpar filtros
        </Button>
      ) : null}
      {isPending ? <Spinner className="self-center" aria-label="Atualizando a lista" /> : null}
    </FieldGroup>
  )
}

"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { SearchIcon, XIcon } from "lucide-react"

import {
  AUTHORIZATION_LIST_FILTER_LABELS,
  type AuthorizationListFilter,
} from "@workspace/core/properties/authorization-alerts"
import {
  LISTING_PURPOSE_LABELS,
  PROPERTY_STATUS_LABELS,
  PROPERTY_TYPE_LABELS,
} from "@workspace/core/properties/enums"
import { Button } from "@workspace/ui/components/button"
import { Field, FieldGroup, FieldLabel } from "@workspace/ui/components/field"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
} from "@workspace/ui/components/input-group"
import { Kbd } from "@workspace/ui/components/kbd"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select"
import { Spinner } from "@workspace/ui/components/spinner"

import { LISTING_PURPOSES, PROPERTY_STATUSES, PROPERTY_TYPES } from "@/lib/imoveis/constants"
import { PROPERTY_SEARCH_INPUT_ID } from "@/lib/imoveis/list-shortcuts"

export type PropertyFilterDefaults = {
  q: string
  status: string
  finalidade: string
  tipo: string
  precoMin: string
  precoMax: string
  quartos: string
  autorizacao: string
}

type Option = { label: string; value: string | null }

/** Tempo entre a última tecla e a busca: dá para digitar "jardim" inteiro antes. */
const TYPING_DELAY_MS = 350

const STATUS_ITEMS: Option[] = [
  { label: "Todos", value: null },
  ...PROPERTY_STATUSES.map((value) => ({
    label: PROPERTY_STATUS_LABELS[value],
    value,
  })),
]

const PURPOSE_ITEMS: Option[] = [
  { label: "Todas", value: null },
  ...LISTING_PURPOSES.map((value) => ({
    label: LISTING_PURPOSE_LABELS[value],
    value,
  })),
]

const TYPE_ITEMS: Option[] = [
  { label: "Todos", value: null },
  ...PROPERTY_TYPES.map((value) => ({
    label: PROPERTY_TYPE_LABELS[value],
    value,
  })),
]

const BEDROOM_ITEMS: Option[] = [
  { label: "Qualquer", value: null },
  ...["1", "2", "3", "4", "5"].map((value) => ({ label: `${value}+`, value })),
]

const AUTHORIZATION_ITEMS: Option[] = [
  { label: "Todas", value: null },
  ...(Object.keys(AUTHORIZATION_LIST_FILTER_LABELS) as AuthorizationListFilter[]).map((value) => ({
    label: AUTHORIZATION_LIST_FILTER_LABELS[value],
    value,
  })),
]

/** Mesma ordem sempre: a string serve para comparar o que está na URL. */
function toQuery(values: PropertyFilterDefaults) {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(values)) {
    const text = value.trim()
    if (text) params.set(key, text)
  }
  return params.toString()
}

function FilterSelect({
  id,
  label,
  items,
  value,
  onValueChange,
}: {
  id: string
  label: string
  items: Option[]
  value: string
  onValueChange: (value: string) => void
}) {
  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Select
        items={items}
        value={value || null}
        onValueChange={(next: string | null) => onValueChange(next ?? "")}
      >
        <SelectTrigger id={id} className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            {items.map((item) => (
              <SelectItem key={item.value ?? "todos"} value={item.value}>
                {item.label}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
    </Field>
  )
}

/**
 * Filtros da lista: viram searchParams e a consulta roda no servidor.
 *
 * Não existe botão "Filtrar": escolher uma opção aplica na hora e digitar
 * aplica depois de uma pausa curta, para a busca não disparar a cada tecla. A
 * URL é reescrita com `replace`, então o botão Voltar do navegador não passa
 * por cada letra digitada.
 */
export function PropertiesFilters({ defaults }: { defaults: PropertyFilterDefaults }) {
  const router = useRouter()
  const [isPending, startTransition] = React.useTransition()
  const [values, setValues] = React.useState(defaults)
  /** Última query que este componente mandou para a URL. */
  const appliedQuery = React.useRef(toQuery(defaults))
  const delay = React.useRef(TYPING_DELAY_MS)

  // Filtros vindos de fora (Limpar, Voltar do navegador, link colado).
  React.useEffect(() => {
    const incoming = toQuery(defaults)
    if (incoming !== appliedQuery.current) {
      appliedQuery.current = incoming
      setValues(defaults)
    }
  }, [defaults])

  React.useEffect(() => {
    const query = toQuery(values)
    if (query === appliedQuery.current) return

    const timer = setTimeout(() => {
      appliedQuery.current = query
      startTransition(() => {
        router.replace(query ? `/imoveis?${query}` : "/imoveis", { scroll: false })
      })
    }, delay.current)

    return () => clearTimeout(timer)
  }, [values, router])

  function update(patch: Partial<PropertyFilterDefaults>, options?: { immediate?: boolean }) {
    delay.current = options?.immediate ? 0 : TYPING_DELAY_MS
    setValues((current) => ({ ...current, ...patch }))
  }

  const hasFilters = Object.values(values).some(Boolean)

  return (
    <form
      role="search"
      aria-label="Filtrar imóveis"
      onSubmit={(event) => {
        // Enter no campo de busca: aplica sem esperar a pausa.
        event.preventDefault()
        delay.current = 0
        setValues((current) => ({ ...current }))
      }}
    >
      <FieldGroup className="gap-3">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-[minmax(0,2fr)_repeat(3,minmax(0,1fr))]">
          <Field>
            <FieldLabel htmlFor={PROPERTY_SEARCH_INPUT_ID}>Buscar</FieldLabel>
            <InputGroup>
              <InputGroupAddon>{isPending ? <Spinner /> : <SearchIcon />}</InputGroupAddon>
              <InputGroupInput
                id={PROPERTY_SEARCH_INPUT_ID}
                name="q"
                type="search"
                value={values.q}
                maxLength={100}
                autoComplete="off"
                aria-keyshortcuts="/"
                aria-describedby="filtro-busca-ajuda"
                placeholder="Código, endereço, bairro, título ou proprietário"
                onChange={(event) => update({ q: event.target.value })}
              />
              <InputGroupAddon align="inline-end" className="hidden sm:flex">
                <Kbd>/</Kbd>
              </InputGroupAddon>
            </InputGroup>
          </Field>
          {/* Sem botão visível de filtrar; este existe para o Enter submeter o formulário. */}
          <button type="submit" className="sr-only">
            Buscar agora
          </button>
          <FilterSelect
            id="filtro-status"
            label="Status"
            items={STATUS_ITEMS}
            value={values.status}
            onValueChange={(status) => update({ status }, { immediate: true })}
          />
          <FilterSelect
            id="filtro-finalidade"
            label="Finalidade"
            items={PURPOSE_ITEMS}
            value={values.finalidade}
            onValueChange={(finalidade) => update({ finalidade }, { immediate: true })}
          />
          <FilterSelect
            id="filtro-tipo"
            label="Tipo"
            items={TYPE_ITEMS}
            value={values.tipo}
            onValueChange={(tipo) => update({ tipo }, { immediate: true })}
          />
        </div>
        <div className="grid grid-cols-1 items-end gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-[repeat(4,minmax(0,1fr))_auto]">
          <Field>
            <FieldLabel htmlFor="filtro-preco-min">Preço mínimo</FieldLabel>
            <InputGroup>
              <InputGroupAddon>
                <InputGroupText>R$</InputGroupText>
              </InputGroupAddon>
              <InputGroupInput
                id="filtro-preco-min"
                name="precoMin"
                inputMode="numeric"
                value={values.precoMin}
                placeholder="0"
                onChange={(event) => update({ precoMin: event.target.value })}
              />
            </InputGroup>
          </Field>
          <Field>
            <FieldLabel htmlFor="filtro-preco-max">Preço máximo</FieldLabel>
            <InputGroup>
              <InputGroupAddon>
                <InputGroupText>R$</InputGroupText>
              </InputGroupAddon>
              <InputGroupInput
                id="filtro-preco-max"
                name="precoMax"
                inputMode="numeric"
                value={values.precoMax}
                placeholder="Sem limite"
                onChange={(event) => update({ precoMax: event.target.value })}
              />
            </InputGroup>
          </Field>
          <FilterSelect
            id="filtro-quartos"
            label="Quartos (mínimo)"
            items={BEDROOM_ITEMS}
            value={values.quartos}
            onValueChange={(quartos) => update({ quartos }, { immediate: true })}
          />
          <FilterSelect
            id="filtro-autorizacao"
            label="Autorização"
            items={AUTHORIZATION_ITEMS}
            value={values.autorizacao}
            onValueChange={(autorizacao) => update({ autorizacao }, { immediate: true })}
          />
          {hasFilters ? (
            <div className="flex sm:col-span-2 lg:col-span-4 xl:col-span-1">
              <Button
                variant="ghost"
                render={<Link href="/imoveis" scroll={false} />}
                nativeButton={false}
                className="flex-1 xl:flex-none"
              >
                <XIcon data-icon="inline-start" />
                Limpar filtros
              </Button>
            </div>
          ) : null}
        </div>
        <p id="filtro-busca-ajuda" className="text-xs text-muted-foreground">
          A busca acontece sozinha enquanto você digita, por código (IMV-000123 ou só 123), título,
          rua, bairro, cidade e nome do proprietário. O filtro de autorização considera só imóveis
          em rascunho, ativos ou reservados.
        </p>
      </FieldGroup>
    </form>
  )
}

"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { SearchIcon, StarIcon, XIcon } from "lucide-react"
import { cn } from "cn"

import { PROPERTY_TYPE_LABELS } from "@workspace/core/properties/enums"
import { Button } from "@workspace/ui/components/button"
import { Field, FieldGroup, FieldLabel } from "@workspace/ui/components/field"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
} from "@workspace/ui/components/input-group"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select"
import { Spinner } from "@workspace/ui/components/spinner"

import {
  CAIXA_BASE_PATH,
  CAIXA_PROPERTY_TYPES,
  CAIXA_SORT_LABELS,
  CAIXA_SORT_VALUES,
} from "@/lib/caixa/constants"
import type { CaixaFacets } from "@/lib/caixa/list-queries"

export type CaixaFilterDefaults = {
  q: string
  uf: string
  cidade: string
  bairro: string
  tipo: string
  modalidade: string
  precoMin: string
  precoMax: string
  financiamento: string
  favoritos: string
  ordenar: string
}

type Option = { label: string; value: string | null }

/** Tempo entre a última tecla e a busca: dá para digitar o endereço inteiro antes. */
const TYPING_DELAY_MS = 350

const countFormat = new Intl.NumberFormat("pt-BR")

const TYPE_ITEMS: Option[] = [
  { label: "Todos", value: null },
  ...CAIXA_PROPERTY_TYPES.map((value) => ({ label: PROPERTY_TYPE_LABELS[value], value })),
]

const FINANCING_ITEMS: Option[] = [
  { label: "Tanto faz", value: null },
  { label: "Aceita financiamento", value: "sim" },
  { label: "Não aceita", value: "nao" },
]

const SORT_ITEMS: Option[] = CAIXA_SORT_VALUES.map((value) => ({
  label: CAIXA_SORT_LABELS[value],
  value: value === "novidades" ? null : value,
}))

/** Mesma ordem sempre: a string serve para comparar o que está na URL. */
function toQuery(values: CaixaFilterDefaults) {
  const params = new URLSearchParams()

  for (const [key, value] of Object.entries(values)) {
    const text = value.trim()

    if (text) {
      params.set(key, text)
    }
  }

  return params.toString()
}

function FilterSelect({
  id,
  label,
  items,
  value,
  disabled,
  onValueChange,
}: {
  id: string
  label: string
  items: Option[]
  value: string
  disabled?: boolean
  onValueChange: (value: string) => void
}) {
  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Select
        items={items}
        value={value || null}
        disabled={disabled}
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
 * Filtros do catálogo da Caixa. Viram searchParams e a consulta roda no
 * servidor, igual à lista de imóveis do CRM: escolher uma opção aplica na hora
 * e digitar aplica depois de uma pausa curta.
 */
export function CaixaFilters({
  defaults,
  facets,
}: {
  defaults: CaixaFilterDefaults
  facets: CaixaFacets
}) {
  const router = useRouter()
  const [isPending, startTransition] = React.useTransition()
  const [values, setValues] = React.useState(defaults)
  const appliedQuery = React.useRef(toQuery(defaults))
  const delay = React.useRef(TYPING_DELAY_MS)

  React.useEffect(() => {
    const incoming = toQuery(defaults)

    if (incoming !== appliedQuery.current) {
      appliedQuery.current = incoming
      setValues(defaults)
    }
  }, [defaults])

  React.useEffect(() => {
    const query = toQuery(values)

    if (query === appliedQuery.current) {
      return
    }

    const timer = setTimeout(() => {
      appliedQuery.current = query
      startTransition(() => {
        router.replace(query ? `${CAIXA_BASE_PATH}?${query}` : CAIXA_BASE_PATH, { scroll: false })
      })
    }, delay.current)

    return () => clearTimeout(timer)
  }, [values, router])

  function update(patch: Partial<CaixaFilterDefaults>, options?: { immediate?: boolean }) {
    delay.current = options?.immediate ? 0 : TYPING_DELAY_MS
    setValues((current) => ({ ...current, ...patch }))
  }

  const ufItems: Option[] = React.useMemo(
    () => [
      { label: "Todas", value: null },
      ...facets.ufs.map((item) => ({
        label: `${item.uf} (${countFormat.format(item.count)})`,
        value: item.uf,
      })),
    ],
    [facets.ufs]
  )

  const cityItems: Option[] = React.useMemo(
    () => [
      { label: "Todas", value: null },
      ...facets.cidades.map((item) => ({
        label: `${item.cidade} (${countFormat.format(item.count)})`,
        value: item.cidade,
      })),
    ],
    [facets.cidades]
  )

  const saleModeItems: Option[] = React.useMemo(
    () => [
      { label: "Todas", value: null },
      ...facets.modalidades.map((item) => ({
        label: `${item.modalidade} (${countFormat.format(item.count)})`,
        value: item.modalidade,
      })),
    ],
    [facets.modalidades]
  )

  const onlyFavorites = values.favoritos === "1"
  const hasFilters = Object.values(values).some(Boolean)

  return (
    <form
      role="search"
      aria-label="Filtrar imóveis da Caixa"
      onSubmit={(event) => {
        event.preventDefault()
        delay.current = 0
        setValues((current) => ({ ...current }))
      }}
    >
      <FieldGroup className="gap-3">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-[minmax(0,2fr)_repeat(3,minmax(0,1fr))]">
          <Field>
            <FieldLabel htmlFor="caixa-busca">Buscar</FieldLabel>
            <InputGroup>
              <InputGroupAddon>{isPending ? <Spinner /> : <SearchIcon />}</InputGroupAddon>
              <InputGroupInput
                id="caixa-busca"
                name="q"
                type="search"
                value={values.q}
                maxLength={100}
                autoComplete="off"
                aria-describedby="caixa-busca-ajuda"
                placeholder="Número do imóvel, endereço, bairro ou cidade"
                onChange={(event) => update({ q: event.target.value })}
              />
            </InputGroup>
          </Field>
          <button type="submit" className="sr-only">
            Buscar agora
          </button>
          <FilterSelect
            id="caixa-uf"
            label="UF"
            items={ufItems}
            value={values.uf}
            onValueChange={(uf) => update({ uf, cidade: "" }, { immediate: true })}
          />
          <FilterSelect
            id="caixa-cidade"
            label="Cidade"
            items={cityItems}
            value={values.cidade}
            disabled={!values.uf}
            onValueChange={(cidade) => update({ cidade }, { immediate: true })}
          />
          <Field>
            <FieldLabel htmlFor="caixa-bairro">Bairro</FieldLabel>
            <InputGroup>
              <InputGroupInput
                id="caixa-bairro"
                name="bairro"
                value={values.bairro}
                maxLength={120}
                autoComplete="off"
                placeholder="Parte do nome"
                onChange={(event) => update({ bairro: event.target.value })}
              />
            </InputGroup>
          </Field>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <FilterSelect
            id="caixa-modalidade"
            label="Modalidade de venda"
            items={saleModeItems}
            value={values.modalidade}
            onValueChange={(modalidade) => update({ modalidade }, { immediate: true })}
          />
          <FilterSelect
            id="caixa-tipo"
            label="Tipo"
            items={TYPE_ITEMS}
            value={values.tipo}
            onValueChange={(tipo) => update({ tipo }, { immediate: true })}
          />
          <Field>
            <FieldLabel htmlFor="caixa-preco-min">Preço mínimo</FieldLabel>
            <InputGroup>
              <InputGroupAddon>
                <InputGroupText>R$</InputGroupText>
              </InputGroupAddon>
              <InputGroupInput
                id="caixa-preco-min"
                name="precoMin"
                inputMode="numeric"
                value={values.precoMin}
                placeholder="0"
                onChange={(event) => update({ precoMin: event.target.value })}
              />
            </InputGroup>
          </Field>
          <Field>
            <FieldLabel htmlFor="caixa-preco-max">Preço máximo</FieldLabel>
            <InputGroup>
              <InputGroupAddon>
                <InputGroupText>R$</InputGroupText>
              </InputGroupAddon>
              <InputGroupInput
                id="caixa-preco-max"
                name="precoMax"
                inputMode="numeric"
                value={values.precoMax}
                placeholder="Sem limite"
                onChange={(event) => update({ precoMax: event.target.value })}
              />
            </InputGroup>
          </Field>
        </div>

        <div className="grid grid-cols-1 items-end gap-3 sm:grid-cols-2 xl:grid-cols-[repeat(2,minmax(0,1fr))_auto_auto]">
          <FilterSelect
            id="caixa-financiamento"
            label="Financiamento Caixa"
            items={FINANCING_ITEMS}
            value={values.financiamento}
            onValueChange={(financiamento) => update({ financiamento }, { immediate: true })}
          />
          <FilterSelect
            id="caixa-ordenar"
            label="Ordenar por"
            items={SORT_ITEMS}
            value={values.ordenar}
            onValueChange={(ordenar) => update({ ordenar }, { immediate: true })}
          />
          <Button
            type="button"
            variant={onlyFavorites ? "secondary" : "outline"}
            aria-pressed={onlyFavorites}
            onClick={() => update({ favoritos: onlyFavorites ? "" : "1" }, { immediate: true })}
          >
            <StarIcon data-icon="inline-start" className={cn(onlyFavorites && "fill-current")} />
            Só favoritos
          </Button>
          {hasFilters ? (
            <Button
              variant="ghost"
              render={<Link href={CAIXA_BASE_PATH} scroll={false} />}
              nativeButton={false}
            >
              <XIcon data-icon="inline-start" />
              Limpar filtros
            </Button>
          ) : null}
        </div>

        <p id="caixa-busca-ajuda" className="text-xs text-muted-foreground">
          A busca acontece sozinha enquanto você digita, pelo número do imóvel na Caixa, endereço,
          bairro, cidade e UF.
        </p>
      </FieldGroup>
    </form>
  )
}

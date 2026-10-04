"use client"

import * as React from "react"
import { ArrowDownIcon, ArrowUpIcon, HomeIcon, TriangleAlertIcon, XIcon } from "lucide-react"

import { PROPERTY_STATUS_LABELS, type PropertyStatus } from "@workspace/core/properties/enums"
import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@workspace/ui/components/combobox"
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from "@workspace/ui/components/item"

import { FallbackImage } from "@/components/media/fallback-image"
import { propertyPrices } from "@/lib/landing/format"
import { searchLandingPropertiesAction } from "@/lib/marketing/actions"
import type { LandingPropertyOption, LandingPropertySnapshot } from "@/lib/marketing/payload"
import { getPropertyPhotoUrls } from "@/lib/media/paths"

const SEARCH_DEBOUNCE_MS = 250

function statusLabel(status: string) {
  return PROPERTY_STATUS_LABELS[status as PropertyStatus] ?? status
}

function PropertyThumb({ property }: { property: LandingPropertySnapshot }) {
  const photo = getPropertyPhotoUrls(property.cover_path)

  return (
    <ItemMedia variant="image">
      {photo.main && photo.thumb ? (
        <FallbackImage
          src={photo.thumb}
          fallbackSrc={photo.main}
          alt=""
          loading="lazy"
          decoding="async"
          className="object-cover"
        />
      ) : (
        <HomeIcon aria-hidden="true" />
      )}
    </ItemMedia>
  )
}

/**
 * Seletor de imóveis ativos com busca no servidor. `single` troca o imóvel;
 * `multiple` acrescenta até `max` e permite reordenar.
 */
export function PropertyPicker({
  id,
  mode,
  max,
  value,
  onChange,
  disabled,
}: {
  id: string
  mode: "single" | "multiple"
  max: number
  value: LandingPropertySnapshot[]
  onChange: (next: LandingPropertySnapshot[]) => void
  disabled?: boolean
}) {
  const [results, setResults] = React.useState<LandingPropertyOption[]>([])
  const [hasSearched, setHasSearched] = React.useState(false)
  const [inputValue, setInputValue] = React.useState("")
  const [isSearching, startSearch] = React.useTransition()
  const requestIdRef = React.useRef(0)
  const timeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)

  React.useEffect(
    () => () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current)
    },
    []
  )

  function scheduleSearch(query: string, delay = SEARCH_DEBOUNCE_MS) {
    if (timeoutRef.current) clearTimeout(timeoutRef.current)
    const requestId = ++requestIdRef.current

    timeoutRef.current = setTimeout(() => {
      startSearch(async () => {
        const options = await searchLandingPropertiesAction(query)
        if (requestId === requestIdRef.current) {
          setResults(options)
          setHasSearched(true)
        }
      })
    }, delay)
  }

  const selectedIds = new Set(value.map((property) => property.id))
  const available = results.filter((option) => !selectedIds.has(option.id))
  const isFull = mode === "multiple" && value.length >= max

  function add(option: LandingPropertyOption | null) {
    if (!option) return
    if (mode === "single") {
      onChange([option.property])
    } else if (!selectedIds.has(option.id) && value.length < max) {
      onChange([...value, option.property])
    }
    setInputValue("")
  }

  function move(index: number, direction: -1 | 1) {
    const target = index + direction
    if (target < 0 || target >= value.length) return
    const next = [...value]
    const current = next[index]
    const swap = next[target]
    if (!current || !swap) return
    next[index] = swap
    next[target] = current
    onChange(next)
  }

  return (
    <div className="flex flex-col gap-3">
      <Combobox
        items={available}
        filter={null}
        value={null}
        inputValue={inputValue}
        onValueChange={(next: LandingPropertyOption | null) => add(next)}
        itemToStringLabel={(option: LandingPropertyOption) => option.label}
        itemToStringValue={(option: LandingPropertyOption) => option.id}
        onOpenChange={(open) => {
          if (open && !hasSearched) scheduleSearch("", 0)
        }}
        onInputValueChange={(next, details) => {
          setInputValue(next)
          if (details.reason === "input-change" || details.reason === "input-clear") {
            scheduleSearch(next)
          }
        }}
        disabled={disabled || isFull}
      >
        <ComboboxInput
          id={id}
          className="w-full"
          placeholder={
            isFull
              ? `Limite de ${max} imóveis atingido`
              : mode === "single" && value.length > 0
                ? "Buscar outro imóvel para trocar"
                : "Buscar imóvel ativo por código ou título"
          }
          disabled={disabled || isFull}
        />
        <ComboboxContent>
          <ComboboxEmpty>
            {isSearching || !hasSearched ? "Buscando…" : "Nenhum imóvel ativo encontrado."}
          </ComboboxEmpty>
          <ComboboxList>
            {(option: LandingPropertyOption) => (
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

      {value.length > 0 ? (
        <ItemGroup className="gap-2" aria-label="Imóveis exibidos na página">
          {value.map((property, index) => {
            const price = propertyPrices(property)[0]
            const inactive = property.status !== "active"

            return (
              <Item key={property.id} variant="outline" size="sm">
                <PropertyThumb property={property} />
                <ItemContent className="min-w-0">
                  <ItemTitle className="w-full truncate">
                    {property.code} · {property.title}
                  </ItemTitle>
                  <ItemDescription className="flex flex-wrap items-center gap-1">
                    {inactive ? (
                      <Badge variant="destructive">
                        <TriangleAlertIcon data-icon="inline-start" />
                        {statusLabel(property.status)}: não aparece na página
                      </Badge>
                    ) : (
                      <span className="truncate">
                        {[
                          price ? `${price.amount}${price.suffix ?? ""}` : null,
                          property.neighborhood,
                        ]
                          .filter(Boolean)
                          .join(" · ") || "Sem preço informado"}
                      </span>
                    )}
                  </ItemDescription>
                </ItemContent>
                <ItemActions>
                  {mode === "multiple" ? (
                    <>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        disabled={disabled || index === 0}
                        onClick={() => move(index, -1)}
                      >
                        <ArrowUpIcon />
                        <span className="sr-only">Subir {property.code}</span>
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        disabled={disabled || index === value.length - 1}
                        onClick={() => move(index, 1)}
                      >
                        <ArrowDownIcon />
                        <span className="sr-only">Descer {property.code}</span>
                      </Button>
                    </>
                  ) : null}
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    disabled={disabled}
                    onClick={() => onChange(value.filter((item) => item.id !== property.id))}
                  >
                    <XIcon />
                    <span className="sr-only">Remover {property.code}</span>
                  </Button>
                </ItemActions>
              </Item>
            )
          })}
        </ItemGroup>
      ) : null}
    </div>
  )
}

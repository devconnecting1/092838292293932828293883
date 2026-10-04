"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { FilterXIcon, SearchIcon } from "lucide-react"

import { Button } from "@workspace/ui/components/button"
import { InputGroup, InputGroupAddon, InputGroupInput } from "@workspace/ui/components/input-group"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select"
import { Spinner } from "@workspace/ui/components/spinner"

import { CLIENT_SOURCE_LABELS, CLIENT_SOURCE_VALUES, CLIENTS_PATH } from "@/lib/clientes/constants"
import {
  buildClientListHref,
  hasActiveClientFilters,
  UNASSIGNED_FILTER,
  type ClientListFilters,
} from "@/lib/clientes/filters"
import type { MemberOption } from "@/lib/clientes/options"
import { sanitizeSearchTerm } from "@/lib/clientes/search"

const SEARCH_DEBOUNCE_MS = 350

const KIND_ITEMS = [
  { label: "Todos os tipos", value: null },
  { label: "Pessoa física", value: "pf" },
  { label: "Pessoa jurídica", value: "pj" },
]

const SOURCE_ITEMS = [
  { label: "Todas as origens", value: null },
  ...CLIENT_SOURCE_VALUES.map((source) => ({
    label: CLIENT_SOURCE_LABELS[source],
    value: source,
  })),
]

type ClientFiltersProps = {
  filters: ClientListFilters
  members: MemberOption[]
  tags: string[]
  showAssigneeFilter: boolean
}

export function ClientFilters({ filters, members, tags, showAssigneeFilter }: ClientFiltersProps) {
  const router = useRouter()
  const [isPending, startTransition] = React.useTransition()
  const timeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)

  // Busca local com debounce; sincroniza quando a URL muda por fora (ex.: limpar).
  const [search, setSearch] = React.useState(filters.busca)
  const [requestedSearch, setRequestedSearch] = React.useState(filters.busca)
  const [syncedSearch, setSyncedSearch] = React.useState(filters.busca)

  if (filters.busca !== syncedSearch) {
    setSyncedSearch(filters.busca)

    if (filters.busca !== requestedSearch) {
      setSearch(filters.busca)
      setRequestedSearch(filters.busca)
    }
  }

  React.useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current)
    }
  }, [])

  function navigate(changes: Partial<ClientListFilters>) {
    startTransition(() => {
      router.replace(buildClientListHref({ ...filters, ...changes, pagina: 1 }), { scroll: false })
    })
  }

  function onSearchChange(value: string) {
    setSearch(value)

    if (timeoutRef.current) clearTimeout(timeoutRef.current)

    timeoutRef.current = setTimeout(() => {
      const term = sanitizeSearchTerm(value)
      setRequestedSearch(term)
      navigate({ busca: term })
    }, SEARCH_DEBOUNCE_MS)
  }

  const assigneeItems = [
    { label: "Todos os responsáveis", value: null },
    { label: "Sem responsável", value: UNASSIGNED_FILTER },
    ...members.map((member) => ({ label: member.name, value: member.id })),
  ]

  const tagItems = [
    { label: "Todas as etiquetas", value: null },
    ...tags.map((tag) => ({ label: tag, value: tag })),
  ]

  return (
    <div className="flex flex-col gap-2 md:flex-row md:flex-wrap md:items-center">
      <InputGroup className="md:max-w-sm">
        <InputGroupAddon>{isPending ? <Spinner /> : <SearchIcon />}</InputGroupAddon>
        <InputGroupInput
          type="search"
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder="Buscar por nome, e-mail, telefone ou documento"
          aria-label="Buscar clientes"
        />
      </InputGroup>

      <Select
        items={KIND_ITEMS}
        value={filters.tipo || null}
        onValueChange={(value) => navigate({ tipo: value === "pf" || value === "pj" ? value : "" })}
      >
        <SelectTrigger className="w-full md:w-40" aria-label="Filtrar por tipo">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            {KIND_ITEMS.map((item) => (
              <SelectItem key={item.label} value={item.value}>
                {item.label}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>

      {showAssigneeFilter ? (
        <Select
          items={assigneeItems}
          value={filters.responsavel || null}
          onValueChange={(value) => navigate({ responsavel: value ?? "" })}
        >
          <SelectTrigger className="w-full md:w-48" aria-label="Filtrar por responsável">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {assigneeItems.map((item) => (
                <SelectItem key={item.value ?? "todos"} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      ) : null}

      <Select
        items={SOURCE_ITEMS}
        value={filters.origem || null}
        onValueChange={(value) => {
          const source = CLIENT_SOURCE_VALUES.find((item) => item === value)
          navigate({ origem: source ?? "" })
        }}
      >
        <SelectTrigger className="w-full md:w-40" aria-label="Filtrar por origem">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            {SOURCE_ITEMS.map((item) => (
              <SelectItem key={item.value ?? "todas"} value={item.value}>
                {item.label}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>

      {tags.length > 0 ? (
        <Select
          items={tagItems}
          value={filters.etiqueta || null}
          onValueChange={(value) => navigate({ etiqueta: value ?? "" })}
        >
          <SelectTrigger className="w-full md:w-44" aria-label="Filtrar por etiqueta">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {tagItems.map((item) => (
                <SelectItem key={item.value ?? "todas"} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      ) : null}

      {hasActiveClientFilters(filters) ? (
        <Button
          variant="ghost"
          onClick={() => {
            if (timeoutRef.current) clearTimeout(timeoutRef.current)
            setSearch("")
            setRequestedSearch("")
            startTransition(() => router.replace(CLIENTS_PATH, { scroll: false }))
          }}
        >
          <FilterXIcon data-icon="inline-start" />
          Limpar filtros
        </Button>
      ) : null}
    </div>
  )
}

"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { FilterXIcon, SearchIcon } from "lucide-react"

import {
  ACCOUNT_SITUATION_LABELS,
  ACCOUNT_SITUATIONS,
  buildOrganizationListHref,
  hasActiveOrganizationFilters,
  isAccountSituation,
  isPlatformPlanKey,
  PLATFORM_ORGANIZATION_SEARCH_MAX_LENGTH,
  PLATFORM_ORGANIZATIONS_PATH,
  PLATFORM_PLAN_KEYS,
  platformPlanLabel,
  sanitizeOrganizationSearch,
  type OrganizationListFilters,
} from "@workspace/core/platform/accounts"
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

const SEARCH_DEBOUNCE_MS = 350

const SITUATION_ITEMS = [
  { label: "Todas as situações", value: null },
  ...ACCOUNT_SITUATIONS.map((situation) => ({
    label: ACCOUNT_SITUATION_LABELS[situation],
    value: situation,
  })),
]

const PLAN_ITEMS = [
  { label: "Todos os planos", value: null },
  ...PLATFORM_PLAN_KEYS.map((plan) => ({ label: platformPlanLabel(plan), value: plan })),
]

/** Busca (nome, subdomínio ou e-mail do dono) e filtros por situação e plano, na URL. */
export function OrganizationFilters({ filters }: { filters: OrganizationListFilters }) {
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

  function navigate(changes: Partial<OrganizationListFilters>) {
    startTransition(() => {
      router.replace(buildOrganizationListHref({ ...filters, ...changes, pagina: 1 }), {
        scroll: false,
      })
    })
  }

  function onSearchChange(value: string) {
    setSearch(value)

    if (timeoutRef.current) clearTimeout(timeoutRef.current)

    timeoutRef.current = setTimeout(() => {
      const term = sanitizeOrganizationSearch(value)
      setRequestedSearch(term)
      navigate({ busca: term })
    }, SEARCH_DEBOUNCE_MS)
  }

  return (
    <div className="flex flex-col gap-2 md:flex-row md:flex-wrap md:items-center">
      <InputGroup className="md:max-w-sm">
        <InputGroupAddon>{isPending ? <Spinner /> : <SearchIcon />}</InputGroupAddon>
        <InputGroupInput
          type="search"
          value={search}
          maxLength={PLATFORM_ORGANIZATION_SEARCH_MAX_LENGTH}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder="Buscar por nome, subdomínio ou e-mail do dono"
          aria-label="Buscar imobiliárias"
        />
      </InputGroup>

      <Select
        items={SITUATION_ITEMS}
        value={filters.situacao || null}
        onValueChange={(value) => navigate({ situacao: isAccountSituation(value) ? value : "" })}
      >
        <SelectTrigger className="w-full md:w-48" aria-label="Filtrar por situação">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            {SITUATION_ITEMS.map((item) => (
              <SelectItem key={item.value ?? "todas"} value={item.value}>
                {item.label}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>

      <Select
        items={PLAN_ITEMS}
        value={filters.plano || null}
        onValueChange={(value) => navigate({ plano: isPlatformPlanKey(value) ? value : "" })}
      >
        <SelectTrigger className="w-full md:w-44" aria-label="Filtrar por plano">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            {PLAN_ITEMS.map((item) => (
              <SelectItem key={item.value ?? "todos"} value={item.value}>
                {item.label}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>

      {hasActiveOrganizationFilters(filters) ? (
        <Button
          variant="ghost"
          onClick={() => {
            if (timeoutRef.current) clearTimeout(timeoutRef.current)
            setSearch("")
            setRequestedSearch("")
            startTransition(() => router.replace(PLATFORM_ORGANIZATIONS_PATH, { scroll: false }))
          }}
        >
          <FilterXIcon data-icon="inline-start" />
          Limpar filtros
        </Button>
      ) : null}
    </div>
  )
}

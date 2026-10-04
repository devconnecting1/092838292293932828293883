"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { HouseIcon, KanbanIcon, SearchIcon, TriangleAlertIcon, UsersIcon } from "lucide-react"

import { Button } from "@workspace/ui/components/button"
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@workspace/ui/components/command"
import { Kbd } from "@workspace/ui/components/kbd"
import { Spinner } from "@workspace/ui/components/spinner"

import { searchCrmAction } from "@/lib/busca/actions"
import {
  GLOBAL_SEARCH_MIN_LENGTH,
  normalizeGlobalSearchTerm,
  type GlobalSearchEntity,
  type GlobalSearchGroup,
} from "@/lib/busca/types"
import { shouldIgnoreShortcut } from "@/lib/imoveis/list-shortcuts"

const SEARCH_DELAY_MS = 250

const ENTITY_ICONS: Record<GlobalSearchEntity, typeof UsersIcon> = {
  client: UsersIcon,
  lead: KanbanIcon,
  property: HouseIcon,
}

type SearchState =
  | { status: "idle" }
  | { status: "loading"; groups: GlobalSearchGroup[] }
  | { status: "done"; term: string; groups: GlobalSearchGroup[] }
  | { status: "error" }

function itemValue(entity: GlobalSearchEntity, id: string) {
  return `${entity}-${id}`
}

function firstValue(groups: GlobalSearchGroup[]) {
  const item = groups[0]?.items[0]
  return item ? itemValue(item.entity, item.id) : ""
}

function countItems(groups: GlobalSearchGroup[]) {
  return groups.reduce((total, group) => total + group.items.length, 0)
}

/**
 * Busca única do cabeçalho: clientes, leads e imóveis pelo nome (sem acento),
 * telefone (só dígitos) ou código do imóvel. Abre com "/" (se a página não usa
 * a tecla para a própria busca, como a lista de imóveis) ou pelo botão; setas
 * navegam, Enter abre e Esc fecha. No celular, o botão vira um ícone.
 */
export function GlobalSearch() {
  const router = useRouter()
  const [open, setOpen] = React.useState(false)
  const [query, setQuery] = React.useState("")
  const [state, setState] = React.useState<SearchState>({ status: "idle" })
  const [selected, setSelected] = React.useState("")
  const requestRef = React.useRef(0)
  const timerRef = React.useRef<number | null>(null)

  React.useEffect(() => {
    // No window (depois do document): o atalho "/" de uma página, como o da
    // lista de imóveis, roda antes e marca o evento; aí este não abre a busca.
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "/" || shouldIgnoreShortcut(event)) return

      event.preventDefault()
      setOpen(true)
    }

    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [])

  React.useEffect(
    () => () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current)
    },
    []
  )

  function cancelPendingSearch() {
    requestRef.current += 1

    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }

  function handleOpenChange(next: boolean) {
    setOpen(next)

    if (!next) {
      cancelPendingSearch()
      setQuery("")
      setState({ status: "idle" })
      setSelected("")
    }
  }

  function handleQueryChange(value: string) {
    setQuery(value)
    cancelPendingSearch()

    const term = normalizeGlobalSearchTerm(value)

    if (term.length < GLOBAL_SEARCH_MIN_LENGTH) {
      setState({ status: "idle" })
      setSelected("")
      return
    }

    const requestId = requestRef.current
    setState((current) => ({
      status: "loading",
      groups: current.status === "done" || current.status === "loading" ? current.groups : [],
    }))

    timerRef.current = window.setTimeout(async () => {
      timerRef.current = null

      try {
        const response = await searchCrmAction(term)

        if (requestId !== requestRef.current) return

        if (response.ok) {
          setState({ status: "done", term, groups: response.groups })
          setSelected(firstValue(response.groups))
        } else {
          setState({ status: "error" })
        }
      } catch {
        if (requestId === requestRef.current) setState({ status: "error" })
      }
    }, SEARCH_DELAY_MS)
  }

  function openResult(href: string) {
    handleOpenChange(false)
    router.push(href)
  }

  const groups = state.status === "done" || state.status === "loading" ? state.groups : []
  const total = countItems(groups)
  const announcement =
    state.status === "loading"
      ? "Buscando…"
      : state.status === "error"
        ? "Não foi possível buscar agora."
        : state.status === "done"
          ? total === 0
            ? "Nada encontrado."
            : `${total} resultado(s).`
          : ""

  return (
    <>
      {/* Celular: ícone com a palavra "Buscar". A partir de md: o campo com o atalho visível. */}
      <Button
        variant="outline"
        aria-keyshortcuts="/"
        onClick={() => setOpen(true)}
        className="md:hidden"
      >
        <SearchIcon data-icon="inline-start" />
        Buscar
        <span className="sr-only"> cliente, lead ou imóvel</span>
      </Button>
      <Button
        variant="outline"
        aria-keyshortcuts="/"
        onClick={() => setOpen(true)}
        className="hidden w-64 justify-start font-normal text-muted-foreground md:inline-flex"
      >
        <SearchIcon data-icon="inline-start" />
        <span className="truncate">Buscar cliente, lead ou imóvel</span>
        <Kbd className="ms-auto" aria-hidden>
          /
        </Kbd>
      </Button>

      <CommandDialog
        open={open}
        onOpenChange={handleOpenChange}
        title="Buscar no CRM"
        description="Procure clientes, leads e imóveis pelo nome, telefone ou código do imóvel."
        className="max-sm:top-4"
      >
        <Command
          shouldFilter={false}
          loop
          label="Buscar clientes, leads e imóveis"
          value={selected}
          onValueChange={setSelected}
        >
          <CommandInput
            value={query}
            onValueChange={handleQueryChange}
            placeholder="Nome, telefone ou código do imóvel"
            maxLength={120}
            autoComplete="off"
            enterKeyHint="search"
          />
          <CommandList label="Resultados da busca" className="max-sm:max-h-[50svh]">
            {state.status === "idle" ? (
              <p className="px-3 py-6 text-center text-sm text-muted-foreground">
                Digite ao menos {GLOBAL_SEARCH_MIN_LENGTH} letras do nome, 4 números do telefone ou
                o código do imóvel.
              </p>
            ) : null}

            {state.status === "loading" && groups.length === 0 ? (
              <div className="flex items-center justify-center gap-2 px-3 py-6 text-sm text-muted-foreground">
                <Spinner />
                Buscando…
              </div>
            ) : null}

            {state.status === "error" ? (
              <div className="flex items-center justify-center gap-2 px-3 py-6 text-center text-sm text-destructive">
                <TriangleAlertIcon className="size-4 shrink-0" aria-hidden />
                Não foi possível buscar agora. Tente de novo em instantes.
              </div>
            ) : null}

            {state.status === "done" && groups.length === 0 ? (
              <CommandEmpty>Nada encontrado para “{state.term}”.</CommandEmpty>
            ) : null}

            {groups.map((group) => {
              const Icon = ENTITY_ICONS[group.entity]

              return (
                <CommandGroup key={group.entity} heading={group.label}>
                  {group.items.map((item) => (
                    <CommandItem
                      key={item.id}
                      value={itemValue(item.entity, item.id)}
                      onSelect={() => openResult(item.href)}
                      className="max-sm:min-h-11"
                    >
                      <Icon className="text-muted-foreground" aria-hidden />
                      <div className="flex min-w-0 flex-col">
                        <span className="truncate">{item.title}</span>
                        {item.description ? (
                          <span className="truncate text-xs text-muted-foreground">
                            {item.description}
                          </span>
                        ) : null}
                      </div>
                    </CommandItem>
                  ))}
                </CommandGroup>
              )
            })}
          </CommandList>

          <div className="flex items-center justify-between gap-2 border-t px-2 pt-1">
            <p className="hidden items-center gap-1 text-xs text-muted-foreground sm:flex">
              <Kbd>↑</Kbd>
              <Kbd>↓</Kbd> navegam, <Kbd>Enter</Kbd> abre e <Kbd>Esc</Kbd> fecha
            </p>
            <Button
              variant="ghost"
              size="sm"
              className="ms-auto"
              onClick={() => handleOpenChange(false)}
            >
              Fechar
            </Button>
          </div>

          <p className="sr-only" aria-live="polite">
            {announcement}
          </p>
        </Command>
      </CommandDialog>
    </>
  )
}

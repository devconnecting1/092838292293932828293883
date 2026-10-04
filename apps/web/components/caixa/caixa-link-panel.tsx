"use client"

import * as React from "react"
import Link from "next/link"
import { LinkIcon, Trash2Icon, UserIcon, UsersIcon } from "lucide-react"

import { Button } from "@workspace/ui/components/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@workspace/ui/components/combobox"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog"
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@workspace/ui/components/field"
import { Item, ItemContent, ItemDescription, ItemTitle } from "@workspace/ui/components/item"
import { Spinner } from "@workspace/ui/components/spinner"
import { Textarea } from "@workspace/ui/components/textarea"
import { toast } from "@workspace/ui/components/toast"

import {
  linkCaixaListingAction,
  searchCaixaLinkTargetsAction,
  unlinkCaixaListingAction,
  type CaixaLinkTarget,
} from "@/lib/caixa/actions"
import type { CaixaListingLink } from "@/lib/caixa/detail-queries"

const SEARCH_DEBOUNCE_MS = 250

function targetKey(target: CaixaLinkTarget) {
  return `${target.kind}:${target.id}`
}

function LinkTargetCombobox({
  value,
  onValueChange,
}: {
  value: CaixaLinkTarget | null
  onValueChange: (value: CaixaLinkTarget | null) => void
}) {
  const [results, setResults] = React.useState<CaixaLinkTarget[]>([])
  const [hasSearched, setHasSearched] = React.useState(false)
  const [isSearching, startSearch] = React.useTransition()
  const requestIdRef = React.useRef(0)
  const timeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)

  React.useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current)
    }
  }, [])

  function scheduleSearch(query: string, delay = SEARCH_DEBOUNCE_MS) {
    if (timeoutRef.current) clearTimeout(timeoutRef.current)
    const requestId = ++requestIdRef.current

    timeoutRef.current = setTimeout(() => {
      startSearch(async () => {
        const options = await searchCaixaLinkTargetsAction(query)

        if (requestId === requestIdRef.current) {
          setResults(options)
          setHasSearched(true)
        }
      })
    }, delay)
  }

  const items =
    value && !results.some((option) => targetKey(option) === targetKey(value))
      ? [value, ...results]
      : results

  return (
    <Combobox
      items={items}
      filter={null}
      value={value}
      onValueChange={(next: CaixaLinkTarget | null) => onValueChange(next)}
      itemToStringLabel={(option: CaixaLinkTarget) => option.label}
      itemToStringValue={(option: CaixaLinkTarget) => targetKey(option)}
      isItemEqualToValue={(option: CaixaLinkTarget, selected: CaixaLinkTarget) =>
        targetKey(option) === targetKey(selected)
      }
      onOpenChange={(open) => {
        if (open && !hasSearched) scheduleSearch("", 0)
      }}
      onInputValueChange={(inputValue, details) => {
        if (details.reason === "input-change" || details.reason === "input-clear") {
          scheduleSearch(inputValue)
        }
      }}
    >
      <ComboboxInput
        id="caixa-vinculo-alvo"
        className="w-full"
        placeholder="Buscar cliente ou lead pelo nome"
        showClear={Boolean(value)}
      />
      <ComboboxContent>
        <ComboboxEmpty>
          {isSearching || !hasSearched ? "Buscando…" : "Nenhum cliente ou lead encontrado."}
        </ComboboxEmpty>
        <ComboboxList>
          {(option: CaixaLinkTarget) => (
            <ComboboxItem key={targetKey(option)} value={option}>
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
  )
}

/**
 * Vínculos deste imóvel da Caixa com a carteira da imobiliária. É o que amarra
 * o catálogo ao CRM: o imóvel passa a aparecer na conversa com o cliente certo,
 * em vez de virar um site de consulta paralelo.
 */
export function CaixaLinkPanel({ numero, links }: { numero: string; links: CaixaListingLink[] }) {
  const [open, setOpen] = React.useState(false)
  const [target, setTarget] = React.useState<CaixaLinkTarget | null>(null)
  const [notes, setNotes] = React.useState("")
  const [isSaving, startSave] = React.useTransition()
  const [removingId, setRemovingId] = React.useState<string | null>(null)
  const [, startRemove] = React.useTransition()

  function submit() {
    if (!target) {
      toast.add({ title: "Escolha um cliente ou lead.", type: "error" })
      return
    }

    const chosen = target

    startSave(async () => {
      const result = await linkCaixaListingAction(
        numero,
        { kind: chosen.kind, id: chosen.id },
        notes
      )

      if (!result.ok) {
        toast.add({ title: "Não foi possível vincular", description: result.error, type: "error" })
        return
      }

      toast.add({ title: result.message ?? "Imóvel ligado à carteira.", type: "success" })
      setOpen(false)
      setTarget(null)
      setNotes("")
    })
  }

  function remove(link: CaixaListingLink) {
    setRemovingId(link.id)

    startRemove(async () => {
      const result = await unlinkCaixaListingAction(numero, link.id)
      setRemovingId(null)

      if (!result.ok) {
        toast.add({ title: "Não foi possível remover", description: result.error, type: "error" })
        return
      }

      toast.add({ title: result.message ?? "Vínculo removido.", type: "success" })
    })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Na sua carteira</CardTitle>
        <CardDescription>
          Clientes e leads da sua imobiliária interessados neste imóvel.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {links.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nenhum cliente ou lead ligado a este imóvel ainda.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {links.map((link) => (
              <li key={link.id} className="flex items-start gap-2 rounded-lg border p-2 text-sm">
                {link.clientId ? (
                  <UserIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                ) : (
                  <UsersIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                )}
                <div className="flex min-w-0 flex-1 flex-col">
                  {link.name ? (
                    <Link
                      href={
                        link.clientId ? `/clientes/${link.clientId}` : `/leads/${link.leadId ?? ""}`
                      }
                      className="font-medium hover:underline"
                    >
                      {link.name}
                    </Link>
                  ) : (
                    <span className="font-medium text-muted-foreground">Registro sem acesso</span>
                  )}
                  <span className="text-xs text-muted-foreground">
                    {link.clientId ? "Cliente" : "Lead"}
                  </span>
                  {link.notes ? <p className="mt-1 text-xs">{link.notes}</p> : null}
                </div>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Remover vínculo"
                  disabled={removingId === link.id}
                  onClick={() => remove(link)}
                >
                  {removingId === link.id ? <Spinner /> : <Trash2Icon />}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
      <CardFooter>
        <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
          <LinkIcon data-icon="inline-start" />
          Ligar a um cliente ou lead
        </Button>
      </CardFooter>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Ligar imóvel da Caixa à carteira</DialogTitle>
            <DialogDescription>
              O imóvel passa a aparecer como interesse do cliente ou do lead escolhido. Nada é
              enviado para a Caixa nem para o cliente.
            </DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="caixa-vinculo-alvo">Cliente ou lead</FieldLabel>
              <LinkTargetCombobox value={target} onValueChange={setTarget} />
              <FieldDescription>
                Só aparecem os registros que você já tem permissão para ver.
              </FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor="caixa-vinculo-nota">Observação (opcional)</FieldLabel>
              <Textarea
                id="caixa-vinculo-nota"
                value={notes}
                maxLength={1000}
                rows={3}
                placeholder="Ex.: conferir data do leilão e situação de ocupação no site da Caixa."
                onChange={(event) => setNotes(event.target.value)}
              />
            </Field>
          </FieldGroup>
          <DialogFooter>
            <DialogClose render={<Button type="button" variant="outline" />}>Cancelar</DialogClose>
            <Button type="button" onClick={submit} disabled={isSaving || !target}>
              {isSaving ? <Spinner /> : null}
              Ligar à carteira
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  )
}

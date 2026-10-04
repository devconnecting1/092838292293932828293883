"use client"

import * as React from "react"
import { PlusIcon, XIcon } from "lucide-react"

import { Badge } from "@workspace/ui/components/badge"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@workspace/ui/components/input-group"

import { CLIENT_TAG_MAX_LENGTH, CLIENT_TAGS_MAX } from "@/lib/clientes/constants"

type TagsInputProps = {
  id?: string
  value: string[]
  onChange: (tags: string[]) => void
  onBlur?: () => void
  /** Valores já usados, sugeridos enquanto digita. */
  suggestions?: readonly string[]
  invalid?: boolean
  disabled?: boolean
  placeholder?: string
  maxItems?: number
  maxLength?: number
  /** Nome do item no rótulo de remoção ("etiqueta", "bairro"). */
  itemName?: string
  listLabel?: string
}

function sameValue(a: string, b: string) {
  return a.toLocaleLowerCase("pt-BR") === b.toLocaleLowerCase("pt-BR")
}

/** Lista de valores livres: Enter, vírgula ou "Adicionar" incluem; Backspace remove o último. */
export function TagsInput({
  id,
  value,
  onChange,
  onBlur,
  suggestions = [],
  invalid,
  disabled,
  placeholder = "Ex.: investidor, primeira compra",
  maxItems = CLIENT_TAGS_MAX,
  maxLength = CLIENT_TAG_MAX_LENGTH,
  itemName = "etiqueta",
  listLabel = "Etiquetas",
}: TagsInputProps) {
  const [draft, setDraft] = React.useState("")
  const listId = React.useId()
  const available = suggestions.filter(
    (suggestion) => !value.some((item) => sameValue(item, suggestion))
  )
  const isFull = value.length >= maxItems

  function addValues(raw: string) {
    const next = [...value]

    for (const part of raw.split(",")) {
      const item = part.trim().slice(0, maxLength)

      if (item && next.length < maxItems && !next.some((existing) => sameValue(existing, item))) {
        next.push(item)
      }
    }

    if (next.length !== value.length) {
      onChange(next)
    }

    setDraft("")
  }

  return (
    <div className="flex flex-col gap-2">
      <InputGroup>
        <InputGroupInput
          id={id}
          value={draft}
          list={listId}
          placeholder={isFull ? `Limite de ${maxItems} itens` : placeholder}
          disabled={disabled || isFull}
          aria-invalid={invalid || undefined}
          onChange={(event) => {
            const next = event.target.value

            if (next.includes(",")) {
              addValues(next)
            } else {
              setDraft(next)
            }
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault()
              addValues(draft)
            } else if (event.key === "Backspace" && !draft && value.length > 0) {
              onChange(value.slice(0, -1))
            }
          }}
          onBlur={() => {
            if (draft.trim()) addValues(draft)
            onBlur?.()
          }}
        />
        <InputGroupAddon align="inline-end">
          <InputGroupButton onClick={() => addValues(draft)} disabled={disabled || !draft.trim()}>
            <PlusIcon data-icon="inline-start" />
            Adicionar
          </InputGroupButton>
        </InputGroupAddon>
      </InputGroup>
      <datalist id={listId}>
        {available.map((suggestion) => (
          <option key={suggestion} value={suggestion} />
        ))}
      </datalist>
      {value.length > 0 ? (
        <ul className="flex flex-wrap gap-1.5" aria-label={listLabel}>
          {value.map((item) => (
            <li key={item}>
              <Badge variant="secondary">
                {item}
                <button
                  type="button"
                  className="-me-1 inline-flex rounded-full opacity-60 outline-hidden hover:opacity-100 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring/50 disabled:pointer-events-none [&>svg]:size-3"
                  onClick={() => onChange(value.filter((current) => current !== item))}
                  disabled={disabled}
                  aria-label={`Remover ${itemName} ${item}`}
                >
                  <XIcon />
                </button>
              </Badge>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}

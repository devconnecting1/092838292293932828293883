"use client"

import * as React from "react"
import { CheckIcon, CopyIcon } from "lucide-react"

import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@workspace/ui/components/input-group"
import { toast } from "@workspace/ui/components/toast"

export function useCopyToClipboard() {
  const [copied, setCopied] = React.useState(false)
  const timeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)

  React.useEffect(
    () => () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current)
    },
    []
  )

  const copy = React.useCallback(async (value: string, successMessage = "Copiado.") => {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      toast.add({ title: successMessage, type: "success" })

      if (timeoutRef.current) clearTimeout(timeoutRef.current)
      timeoutRef.current = setTimeout(() => setCopied(false), 2000)
    } catch {
      toast.add({
        title: "Não foi possível copiar",
        description: "Selecione o texto e copie manualmente.",
        type: "error",
      })
    }
  }, [])

  return { copied, copy }
}

/** Campo somente leitura com botão de copiar (URLs do feed e de convites). */
export function CopyField({
  id,
  value,
  label,
  successMessage = "Link copiado.",
}: {
  id: string
  value: string
  /** Rótulo acessível quando não há FieldLabel apontando para o campo. */
  label?: string
  successMessage?: string
}) {
  const { copied, copy } = useCopyToClipboard()

  return (
    <InputGroup>
      <InputGroupInput
        id={id}
        value={value}
        readOnly
        spellCheck={false}
        aria-label={label}
        onFocus={(event) => event.currentTarget.select()}
      />
      <InputGroupAddon align="inline-end">
        <InputGroupButton onClick={() => copy(value, successMessage)}>
          {copied ? <CheckIcon data-icon="inline-start" /> : <CopyIcon data-icon="inline-start" />}
          {copied ? "Copiado" : "Copiar"}
        </InputGroupButton>
      </InputGroupAddon>
    </InputGroup>
  )
}

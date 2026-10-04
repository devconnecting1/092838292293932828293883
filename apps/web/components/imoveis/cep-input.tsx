"use client"

import * as React from "react"
import { SearchIcon } from "lucide-react"

import type { CepAddress } from "@/lib/br/cep"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@workspace/ui/components/input-group"
import { Spinner } from "@workspace/ui/components/spinner"

import { lookupCepAction } from "@/lib/imoveis/cep-actions"
import { maskPostalCodeInput } from "@/lib/imoveis/number"

type CepInputProps = Omit<
  React.ComponentProps<"input">,
  "value" | "onChange" | "type" | "onBlur"
> & {
  value: string
  onValueChange: (value: string) => void
  onBlur?: () => void
  /** Endereço encontrado; quem usa decide quais campos preencher. */
  onAddressFound: (address: CepAddress) => void
  /** Erro da consulta (null limpa a mensagem anterior). */
  onLookupError?: (message: string | null) => void
}

/**
 * CEP com máscara e consulta (ViaCEP/BrasilAPI via Server Action) pelo botão
 * ou ao sair do campo com os 8 dígitos preenchidos.
 */
export function CepInput({
  value,
  onValueChange,
  onBlur,
  onAddressFound,
  onLookupError,
  disabled,
  ...props
}: CepInputProps) {
  const [isLookingUp, startLookup] = React.useTransition()
  const lastLookupRef = React.useRef<string | null>(null)

  function runLookup(force: boolean) {
    const digits = value.replace(/\D/g, "")
    if (digits.length !== 8) {
      if (force) onLookupError?.("Informe os 8 dígitos do CEP para consultar.")
      return
    }
    if (!force && lastLookupRef.current === digits) return

    lastLookupRef.current = digits
    onLookupError?.(null)

    startLookup(async () => {
      const result = await lookupCepAction(digits)
      if (result.ok) {
        onAddressFound(result.data)
      } else {
        onLookupError?.(result.error)
      }
    })
  }

  return (
    <InputGroup>
      <InputGroupInput
        {...props}
        type="text"
        inputMode="numeric"
        autoComplete="postal-code"
        placeholder={props.placeholder ?? "00000-000"}
        disabled={disabled}
        value={value}
        onChange={(event) => onValueChange(maskPostalCodeInput(event.target.value))}
        onBlur={() => {
          onBlur?.()
          runLookup(false)
        }}
      />
      <InputGroupAddon align="inline-end">
        <InputGroupButton
          onClick={() => runLookup(true)}
          disabled={disabled || isLookingUp || value.replace(/\D/g, "").length !== 8}
        >
          {isLookingUp ? (
            <Spinner data-icon="inline-start" />
          ) : (
            <SearchIcon data-icon="inline-start" />
          )}
          Buscar
        </InputGroupButton>
      </InputGroupAddon>
    </InputGroup>
  )
}

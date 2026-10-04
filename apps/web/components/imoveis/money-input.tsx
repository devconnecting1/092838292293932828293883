"use client"

import * as React from "react"

import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
} from "@workspace/ui/components/input-group"

import { maskBrlInput } from "@/lib/imoveis/number"

type MoneyInputProps = Omit<React.ComponentProps<"input">, "value" | "onChange" | "type"> & {
  value: string
  onValueChange: (value: string) => void
  /** Texto após o valor, ex.: "/mês". */
  suffix?: string
}

/** Campo de moeda com máscara pt-BR ("1.234,56"). O valor fica como texto. */
export function MoneyInput({ value, onValueChange, suffix, ...props }: MoneyInputProps) {
  return (
    <InputGroup>
      <InputGroupAddon>
        <InputGroupText>R$</InputGroupText>
      </InputGroupAddon>
      <InputGroupInput
        {...props}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        placeholder={props.placeholder ?? "0,00"}
        value={value}
        onChange={(event) => onValueChange(maskBrlInput(event.target.value))}
      />
      {suffix ? (
        <InputGroupAddon align="inline-end">
          <InputGroupText>{suffix}</InputGroupText>
        </InputGroupAddon>
      ) : null}
    </InputGroup>
  )
}

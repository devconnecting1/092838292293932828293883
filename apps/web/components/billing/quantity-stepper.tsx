"use client"

import { MinusIcon, PlusIcon } from "lucide-react"

import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@workspace/ui/components/input-group"

/** Converte o texto digitado num inteiro entre 0 e `max` (inválido → 0). */
export function parseQuantity(value: string, max: number) {
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) ? Math.min(max, Math.max(0, parsed)) : 0
}

type QuantityStepperProps = {
  id: string
  /** Texto digitado (pode estar vazio enquanto a pessoa edita). */
  value: string
  /** Quantidade já normalizada, usada nos botões. */
  quantity: number
  max: number
  disabled?: boolean
  /** "usuário extra", "pacote": vai no rótulo acessível dos botões. */
  itemLabel: string
  onValueChange: (value: string) => void
  describedBy?: string
}

/** Campo numérico com botões de menos e mais (usuários extras, pacotes de imóveis). */
export function QuantityStepper({
  id,
  value,
  quantity,
  max,
  disabled = false,
  itemLabel,
  onValueChange,
  describedBy,
}: QuantityStepperProps) {
  return (
    <InputGroup className="w-36">
      <InputGroupAddon align="inline-start">
        <InputGroupButton
          size="icon-xs"
          aria-label={`Remover um ${itemLabel}`}
          disabled={quantity <= 0 || disabled}
          onClick={() => onValueChange(String(Math.max(0, quantity - 1)))}
        >
          <MinusIcon />
        </InputGroupButton>
      </InputGroupAddon>
      <InputGroupInput
        id={id}
        type="number"
        inputMode="numeric"
        min={0}
        max={max}
        value={value}
        disabled={disabled}
        aria-describedby={describedBy}
        onChange={(event) => onValueChange(event.target.value)}
        onBlur={() => onValueChange(String(quantity))}
      />
      <InputGroupAddon align="inline-end">
        <InputGroupButton
          size="icon-xs"
          aria-label={`Adicionar um ${itemLabel}`}
          disabled={quantity >= max || disabled}
          onClick={() => onValueChange(String(Math.min(max, quantity + 1)))}
        >
          <PlusIcon />
        </InputGroupButton>
      </InputGroupAddon>
    </InputGroup>
  )
}

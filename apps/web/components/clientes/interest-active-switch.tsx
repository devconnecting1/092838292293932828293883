"use client"

import * as React from "react"

import { Field, FieldLabel } from "@workspace/ui/components/field"
import { Switch } from "@workspace/ui/components/switch"
import { toast } from "@workspace/ui/components/toast"

import { setClientInterestActive } from "@/lib/clientes/interest-actions"

type InterestActiveSwitchProps = {
  interestId: string
  clientId: string
  active: boolean
  disabled?: boolean
}

export function InterestActiveSwitch({
  interestId,
  clientId,
  active,
  disabled,
}: InterestActiveSwitchProps) {
  const [optimisticActive, setOptimisticActive] = React.useOptimistic(active)
  const [isPending, startTransition] = React.useTransition()
  const id = `interesse-ativo-${interestId}`

  return (
    <Field orientation="horizontal" className="w-auto" data-disabled={disabled || undefined}>
      <Switch
        id={id}
        checked={optimisticActive}
        disabled={disabled || isPending}
        onCheckedChange={(checked) => {
          startTransition(async () => {
            setOptimisticActive(checked)
            const result = await setClientInterestActive(interestId, clientId, checked)

            if (!result.ok) {
              toast.add({ title: result.error, type: "error" })
            }
          })
        }}
      />
      <FieldLabel htmlFor={id} className="font-normal">
        {optimisticActive ? "Ativo" : "Inativo"}
      </FieldLabel>
    </Field>
  )
}

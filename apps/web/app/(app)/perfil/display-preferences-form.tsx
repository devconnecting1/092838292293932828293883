"use client"

import * as React from "react"

import {
  Field,
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@workspace/ui/components/field"
import { Switch } from "@workspace/ui/components/switch"
import { toast } from "@workspace/ui/components/toast"

import type { ActionResult } from "@/lib/auth/action-result"
import { setGettingStartedDismissed, setLargeText } from "@/lib/preferencias/actions"

type ToggleProps = {
  id: string
  label: string
  description: string
  checked: boolean
  save: (next: boolean) => Promise<ActionResult>
}

function PreferenceToggle({ id, label, description, checked, save }: ToggleProps) {
  const [optimistic, setOptimistic] = React.useOptimistic(checked)
  const [isPending, startTransition] = React.useTransition()

  return (
    <Field orientation="horizontal">
      <FieldContent>
        <FieldLabel htmlFor={id}>{label}</FieldLabel>
        <FieldDescription>{description}</FieldDescription>
      </FieldContent>
      <Switch
        id={id}
        checked={optimistic}
        disabled={isPending}
        onCheckedChange={(next) => {
          startTransition(async () => {
            setOptimistic(next)

            let result: ActionResult

            try {
              result = await save(next)
            } catch {
              result = { ok: false, error: "Sem conexão. Tente de novo quando a internet voltar." }
            }

            toast.add(
              result.ok
                ? { title: result.message ?? "Preferência salva.", type: "success" }
                : { title: "Não foi possível salvar", description: result.error, type: "error" }
            )
          })
        }}
      />
    </Field>
  )
}

type DisplayPreferencesFormProps = {
  largeText: boolean
  /** Dono e gerente veem o cartão "Comece por aqui" no painel. */
  gettingStarted: { visible: boolean } | null
}

/** "Letra e botões maiores" e o cartão "Comece por aqui" (salva a cada troca). */
export function DisplayPreferencesForm({ largeText, gettingStarted }: DisplayPreferencesFormProps) {
  return (
    <FieldGroup>
      <PreferenceToggle
        id="preferencia-letra-maior"
        label="Letra e botões maiores"
        description="Aumenta o texto, os botões e os campos em todas as telas do CRM, também no celular."
        checked={largeText}
        save={setLargeText}
      />
      {gettingStarted ? (
        <PreferenceToggle
          id="preferencia-comece-por-aqui"
          label="Mostrar o Comece por aqui no painel"
          description="Os primeiros passos para deixar a imobiliária pronta, marcados sozinhos conforme você avança."
          checked={gettingStarted.visible}
          save={(next) => setGettingStartedDismissed(!next)}
        />
      ) : null}
    </FieldGroup>
  )
}

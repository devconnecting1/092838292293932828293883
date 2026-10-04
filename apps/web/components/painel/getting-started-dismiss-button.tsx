"use client"

import * as React from "react"
import { EyeOffIcon } from "lucide-react"

import { Button } from "@workspace/ui/components/button"
import { Spinner } from "@workspace/ui/components/spinner"
import { toast } from "@workspace/ui/components/toast"

import { setGettingStartedDismissed } from "@/lib/preferencias/actions"

/** "Esconder" o cartão "Comece por aqui" (volta em Meu perfil > Tela). */
export function GettingStartedDismissButton() {
  const [isPending, startTransition] = React.useTransition()

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      disabled={isPending}
      onClick={() => {
        startTransition(async () => {
          try {
            const result = await setGettingStartedDismissed(true)

            toast.add(
              result.ok
                ? { title: result.message ?? "Cartão escondido.", type: "success" }
                : { title: "Não foi possível esconder", description: result.error, type: "error" }
            )
          } catch {
            toast.add({
              title: "Sem conexão",
              description: "Tente esconder de novo quando a internet voltar.",
              type: "error",
            })
          }
        })
      }}
    >
      {isPending ? <Spinner data-icon="inline-start" /> : <EyeOffIcon data-icon="inline-start" />}
      Esconder
    </Button>
  )
}

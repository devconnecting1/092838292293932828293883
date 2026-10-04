"use client"

import * as React from "react"
import { Disc3Icon } from "lucide-react"

import { Button } from "@workspace/ui/components/button"
import { Spinner } from "@workspace/ui/components/spinner"
import { toast } from "@workspace/ui/components/toast"

import { assignLeadFromRoulette } from "@/lib/leads/actions"

/**
 * Entrega o lead ao próximo corretor da roleta. Só aparece para dono, gerente e
 * assistente e com o rodízio ligado — quem decide de verdade é a RPC
 * `assign_lead_from_roulette`, dentro de uma transação.
 */
export function AssignRouletteButton({ leadId, disabled }: { leadId: string; disabled?: boolean }) {
  const [isPending, startTransition] = React.useTransition()

  function distribute() {
    startTransition(async () => {
      const result = await assignLeadFromRoulette(leadId)

      if (!result.ok) {
        toast.add({
          title: "Não foi possível distribuir o lead",
          description: result.error,
          type: "error",
        })
        return
      }

      toast.add({ title: result.message ?? "Lead distribuído.", type: "success" })
    })
  }

  return (
    <Button size="sm" variant="outline" disabled={disabled || isPending} onClick={distribute}>
      {isPending ? <Spinner data-icon="inline-start" /> : <Disc3Icon data-icon="inline-start" />}
      Distribuir pelo rodízio
    </Button>
  )
}

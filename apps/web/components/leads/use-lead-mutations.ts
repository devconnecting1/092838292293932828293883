"use client"

import * as React from "react"

import { toast } from "@workspace/ui/components/toast"

import type { ActionResult } from "@/lib/auth/action-result"
import {
  assignLead as assignLeadAction,
  moveLead as moveLeadAction,
  registerLeadContact,
} from "@/lib/leads/actions"
import { LEAD_STAGE_LABELS, OPEN_LEAD_STAGES, type LeadContactInput } from "@/lib/leads/constants"
import type { LeadStage } from "@/lib/leads/db-types"
import { compareLeadOrder, planLeadPosition } from "@/lib/leads/position"
import type { LeadItem } from "@/lib/leads/types"

type LeadPatch = Partial<
  Pick<
    LeadItem,
    "stage" | "position" | "lostReason" | "assignedTo" | "lastContactAt" | "firstContactAt"
  >
>

type OptimisticAction = { patches: { id: string; patch: LeadPatch }[] }

function applyPatches(leads: LeadItem[], action: OptimisticAction) {
  const patches = new Map(action.patches.map((item) => [item.id, item.patch]))

  return leads.map((lead) => {
    const patch = patches.get(lead.id)
    return patch ? { ...lead, ...patch } : lead
  })
}

export type LostMoveRequest = {
  leadId: string
  leadName: string
  index: number | null
}

type UseLeadMutationsOptions = {
  /** Quadro: calcula a posição na coluna. Página do lead: mantém a posição atual. */
  managePositions: boolean
}

const FALLBACK_LOST_REASON = "Motivo não informado"

/**
 * Mutações do funil com atualização otimista (useOptimistic): a interface muda
 * na hora e volta sozinha ao estado do servidor quando a transição termina — em
 * caso de erro, o toast explica e nada fica aplicado.
 */
export function useLeadMutations(leads: LeadItem[], { managePositions }: UseLeadMutationsOptions) {
  const [optimisticLeads, applyOptimistic] = React.useOptimistic(leads, applyPatches)
  const [isPending, startTransition] = React.useTransition()
  const [announcement, setAnnouncement] = React.useState("")
  const [lostRequest, setLostRequest] = React.useState<LostMoveRequest | null>(null)

  function run(
    action: OptimisticAction,
    perform: () => Promise<ActionResult>,
    errorTitle: string,
    successToast?: boolean
  ) {
    startTransition(async () => {
      applyOptimistic(action)
      const result = await perform()

      if (!result.ok) {
        toast.add({
          title: errorTitle,
          description: result.error,
          type: "error",
        })
        setAnnouncement(`${errorTitle}. ${result.error}`)
        return
      }

      if (successToast && result.message) {
        toast.add({ title: result.message, type: "success" })
      }
    })
  }

  function moveLead(
    leadId: string,
    stage: LeadStage,
    index: number | null = null,
    lostReason?: string
  ) {
    const lead = optimisticLeads.find((item) => item.id === leadId)

    if (!lead) return

    // Ir para "Perdido" pede o motivo antes (reordenar dentro de Perdido não).
    if (stage === "lost" && lead.stage !== "lost" && lostReason === undefined) {
      setLostRequest({ leadId, leadName: lead.name, index })
      return
    }

    let position: number | null = null
    let renumber: { id: string; position: number }[] = []
    let targetIndex = 0
    let columnSize = 1

    if (managePositions) {
      const currentColumn = optimisticLeads
        .filter((item) => item.stage === lead.stage)
        .sort(compareLeadOrder)
      const currentIndex = currentColumn.findIndex((item) => item.id === leadId)
      const column = optimisticLeads
        .filter((item) => item.stage === stage && item.id !== leadId)
        .sort(compareLeadOrder)

      targetIndex = index ?? (stage === lead.stage ? currentIndex : 0)
      columnSize = column.length + 1

      if (stage === lead.stage && targetIndex === currentIndex) {
        return
      }

      const plan = planLeadPosition(column, targetIndex, leadId)

      if (plan.kind === "single") {
        position = plan.position
      } else {
        position = plan.positions.find((item) => item.id === leadId)?.position ?? null
        renumber = plan.positions.filter((item) => item.id !== leadId)
      }
    } else if (stage === lead.stage) {
      return
    }

    const reason = stage === "lost" ? (lostReason ?? lead.lostReason ?? FALLBACK_LOST_REASON) : null
    // Mudar a etapa não é contato: o 1º contato continua pendente até "Registrar
    // contato" ou o WhatsApp com "Conseguiu falar? Sim".
    const patch: LeadPatch = { stage, lostReason: reason }

    if (
      lead.stage === "new" &&
      stage !== "new" &&
      !lead.firstContactAt &&
      OPEN_LEAD_STAGES.includes(stage)
    ) {
      toast.add({
        title: "1º contato ainda não registrado",
        description:
          "Mudar a etapa não conta como contato. Use “Registrar contato” ou o WhatsApp do lead para sair de “fora do prazo”.",
      })
    }

    if (position !== null) {
      patch.position = position
    }

    setAnnouncement(
      stage === lead.stage
        ? `${lead.name}: posição ${targetIndex + 1} de ${columnSize} em ${LEAD_STAGE_LABELS[stage]}.`
        : `${lead.name} movido para ${LEAD_STAGE_LABELS[stage]}.`
    )

    run(
      {
        patches: [
          { id: leadId, patch },
          ...renumber.map((item) => ({
            id: item.id,
            patch: { position: item.position },
          })),
        ],
      },
      () =>
        moveLeadAction({
          leadId,
          stage,
          position,
          lostReason: reason,
          renumber,
        }),
      "Não foi possível mover o lead"
    )
  }

  function confirmLostMove(reason: string) {
    if (!lostRequest) return

    const request = lostRequest
    setLostRequest(null)
    moveLead(request.leadId, "lost", request.index, reason)
  }

  function cancelLostMove() {
    setLostRequest(null)
  }

  function assignLead(leadId: string, assigneeId: string | null) {
    const lead = optimisticLeads.find((item) => item.id === leadId)

    if (!lead || lead.assignedTo === assigneeId) return

    run(
      { patches: [{ id: leadId, patch: { assignedTo: assigneeId } }] },
      () => assignLeadAction(leadId, assigneeId),
      "Não foi possível alterar o responsável",
      true
    )
  }

  /**
   * "Registrar contato" e a volta do WhatsApp ("Conseguiu falar?"). Só o Sim
   * atualiza o último contato e, na primeira vez, o primeiro — o que tira o lead
   * de "fora do prazo" na hora. O Não grava a tentativa e não muda o lead.
   */
  function registerContact(leadId: string, contact: LeadContactInput) {
    const lead = optimisticLeads.find((item) => item.id === leadId)

    if (!lead) return

    const contactAt = new Date().toISOString()

    run(
      {
        patches: contact.reached
          ? [
              {
                id: leadId,
                patch: {
                  lastContactAt: contactAt,
                  firstContactAt: lead.firstContactAt ?? contactAt,
                  stage: lead.stage === "new" ? "contacted" : lead.stage,
                },
              },
            ]
          : [],
      },
      () => registerLeadContact({ leadId, ...contact }),
      "Não foi possível registrar o contato",
      true
    )
  }

  return {
    leads: optimisticLeads,
    isPending,
    announcement,
    lostRequest,
    moveLead,
    confirmLostMove,
    cancelLostMove,
    assignLead,
    registerContact,
  }
}

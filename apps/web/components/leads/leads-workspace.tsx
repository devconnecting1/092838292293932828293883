"use client"

import * as React from "react"

import { KanbanBoard } from "@/components/leads/kanban-board"
import { LeadDetailSheet } from "@/components/leads/lead-detail-sheet"
import { LeadsTable } from "@/components/leads/leads-table"
import { LostReasonDialog } from "@/components/leads/lost-reason-dialog"
import { useLeadMutations } from "@/components/leads/use-lead-mutations"
import { useNow } from "@/components/leads/use-now"
import type { Role } from "@/lib/auth/roles"
import type { MemberOption } from "@/lib/clientes/options"
import { loadLeadDetailExtras } from "@/lib/leads/actions"
import type { LeadView } from "@/lib/leads/filters"
import type { LeadDetailExtras, LeadItem, LeadSlaSettings } from "@/lib/leads/types"

type ExtrasState = {
  leadId: string
  data: LeadDetailExtras | null
  error: string | null
}

type LeadsWorkspaceProps = {
  leads: LeadItem[]
  members: MemberOption[]
  currentUserId: string
  role: Role
  nowMs: number
  sla: LeadSlaSettings
  view: LeadView
}

/** Quadro ou lista, painel de detalhe e diálogo de perda, sobre o mesmo estado otimista. */
export function LeadsWorkspace({
  leads,
  members,
  currentUserId,
  role,
  nowMs,
  sla,
  view,
}: LeadsWorkspaceProps) {
  const now = useNow(nowMs)
  const mutations = useLeadMutations(leads, { managePositions: true })
  const [selectedId, setSelectedId] = React.useState<string | null>(null)
  const [extras, setExtras] = React.useState<ExtrasState | null>(null)
  const [, startLoadingExtras] = React.useTransition()
  const requestRef = React.useRef(0)

  const selectedLead = selectedId
    ? (mutations.leads.find((lead) => lead.id === selectedId) ?? null)
    : null
  const selectedExtras = extras && extras.leadId === selectedId ? extras : null

  /**
   * Linha do tempo, cliente vinculado e histórico dele. Sempre vai ao servidor:
   * a linha do tempo existe desde a criação, mesmo sem cliente vinculado.
   */
  function loadExtras(leadId: string) {
    const requestId = ++requestRef.current

    setExtras((current) =>
      current?.leadId === leadId && current.data ? current : { leadId, data: null, error: null }
    )

    startLoadingExtras(async () => {
      const result = await loadLeadDetailExtras(leadId)

      if (requestId !== requestRef.current) return

      setExtras(
        result.ok
          ? { leadId, data: result.data, error: null }
          : { leadId, data: null, error: result.error }
      )
    })
  }

  function openLead(leadId: string) {
    const lead = mutations.leads.find((item) => item.id === leadId)

    if (!lead) return

    setSelectedId(leadId)
    loadExtras(leadId)
  }

  return (
    <>
      {view === "lista" ? (
        <LeadsTable
          leads={mutations.leads}
          members={members}
          nowMs={now}
          sla={sla}
          currentUserId={currentUserId}
          role={role}
          onOpenLead={openLead}
          onMoveLead={mutations.moveLead}
          onMarkContacted={mutations.registerContact}
        />
      ) : (
        <KanbanBoard
          leads={mutations.leads}
          members={members}
          nowMs={now}
          sla={sla}
          currentUserId={currentUserId}
          role={role}
          onOpenLead={openLead}
          onMoveLead={mutations.moveLead}
        />
      )}

      <LeadDetailSheet
        lead={selectedLead}
        open={selectedLead !== null}
        onOpenChange={(open) => {
          if (!open) setSelectedId(null)
        }}
        members={members}
        currentUserId={currentUserId}
        role={role}
        nowMs={now}
        sla={sla}
        extras={selectedExtras?.data ?? null}
        extrasError={selectedExtras?.error ?? null}
        isPending={mutations.isPending}
        onStageChange={(stage) => {
          if (selectedLead) mutations.moveLead(selectedLead.id, stage, null)
        }}
        onAssign={(assigneeId) => {
          if (selectedLead) mutations.assignLead(selectedLead.id, assigneeId)
        }}
        onMarkContacted={(contact) => {
          if (selectedLead) mutations.registerContact(selectedLead.id, contact)
        }}
        onConverted={() => {
          if (selectedLead) loadExtras(selectedLead.id)
        }}
        onActivityAdded={() => {
          if (selectedLead) loadExtras(selectedLead.id)
        }}
        onDeleted={() => setSelectedId(null)}
      />

      <LostReasonDialog
        open={mutations.lostRequest !== null}
        leadName={mutations.lostRequest?.leadName ?? null}
        onConfirm={mutations.confirmLostMove}
        onCancel={mutations.cancelLostMove}
      />

      <p aria-live="polite" className="sr-only">
        {mutations.announcement}
      </p>
    </>
  )
}

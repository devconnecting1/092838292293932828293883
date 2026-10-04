"use client"

import * as React from "react"
import { ChevronDownIcon, ChevronRightIcon, MoreHorizontalIcon } from "lucide-react"
import { cn } from "cn"

import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import { Kbd } from "@workspace/ui/components/kbd"

import { LeadCard } from "@/components/leads/lead-card"
import type { Role } from "@/lib/auth/roles"
import type { MemberOption } from "@/lib/clientes/options"
import { COLLAPSED_BY_DEFAULT_STAGES, LEAD_STAGE_LABELS, LEAD_STAGES } from "@/lib/leads/constants"
import type { LeadStage } from "@/lib/leads/db-types"
import { canEditLead } from "@/lib/leads/permissions"
import { compareLeadOrder } from "@/lib/leads/position"
import type { LeadItem, LeadSlaSettings } from "@/lib/leads/types"

const HINT_ID = "leads-quadro-atalhos"

type DropTarget = { stage: LeadStage; index: number }

export type KanbanBoardProps = {
  leads: LeadItem[]
  members: MemberOption[]
  nowMs: number
  sla: LeadSlaSettings
  currentUserId: string
  role: Role
  onOpenLead: (leadId: string) => void
  /** index: posição na coluna de destino (sem o lead movido); null = topo/mesma posição. */
  onMoveLead: (leadId: string, stage: LeadStage, index: number | null) => void
}

/** Índice de inserção pela altura do ponteiro, ignorando o card arrastado. */
function computeDropIndex(container: HTMLElement, clientY: number, draggingId: string) {
  let index = 0

  for (const card of container.querySelectorAll<HTMLElement>("[data-lead-card]")) {
    if (card.dataset.leadId === draggingId) continue

    const rect = card.getBoundingClientRect()

    if (clientY < rect.top + rect.height / 2) break

    index += 1
  }

  return index
}

/**
 * Quadro do funil. Arrastar usa a API nativa de drag and drop do HTML5; o
 * mesmo resultado sai pelo teclado (Alt + setas no nome do lead) e pelo menu
 * de cada card (⋯), que é o caminho no celular: não depende de arrastar.
 * A ajuda visível muda com o tipo de ponteiro (toque ou mouse).
 */
export function KanbanBoard({
  leads,
  members,
  nowMs,
  sla,
  currentUserId,
  role,
  onOpenLead,
  onMoveLead,
}: KanbanBoardProps) {
  const [collapsed, setCollapsed] = React.useState<ReadonlySet<LeadStage>>(
    () => new Set(COLLAPSED_BY_DEFAULT_STAGES)
  )
  const [draggingId, setDraggingId] = React.useState<string | null>(null)
  const [dropTarget, setDropTarget] = React.useState<DropTarget | null>(null)
  const [focusId, setFocusId] = React.useState<string | null>(null)

  const membersById = new Map(members.map((member) => [member.id, member]))
  const columns = LEAD_STAGES.map((stage) => ({
    stage,
    leads: leads.filter((lead) => lead.stage === stage).sort(compareLeadOrder),
  }))

  function canMove(lead: LeadItem) {
    return canEditLead(role, { assignedTo: lead.assignedTo }, currentUserId)
  }

  function setStageCollapsed(stage: LeadStage, value: boolean) {
    setCollapsed((current) => {
      if (current.has(stage) === value) return current

      const next = new Set(current)
      if (value) next.add(stage)
      else next.delete(stage)
      return next
    })
  }

  /** Movimento pelo teclado/menu: mantém o foco no card na nova posição. */
  function moveWithFocus(lead: LeadItem, stage: LeadStage, index: number | null) {
    setStageCollapsed(stage, false)
    setFocusId(lead.id)
    onMoveLead(lead.id, stage, index)
  }

  function stepStage(lead: LeadItem, delta: -1 | 1) {
    const next = LEAD_STAGES[LEAD_STAGES.indexOf(lead.stage) + delta]
    if (next) moveWithFocus(lead, next, null)
  }

  function finishDrag() {
    setDraggingId(null)
    setDropTarget(null)
  }

  function dropLead(stage: LeadStage, leadId: string, index: number) {
    finishDrag()

    const lead = leads.find((item) => item.id === leadId)

    if (lead && canMove(lead)) {
      onMoveLead(lead.id, stage, index)
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <p id={HINT_ID} className="sr-only">
        Enter abre os detalhes. Para mudar a etapa ou a ordem, use o botão de ações do lead. Com
        teclado, Alt com seta para a esquerda ou para a direita muda a etapa; Alt com seta para cima
        ou para baixo muda a ordem na coluna.
      </p>

      {/* Toque (celular e tablet): arrastar não é o caminho; o menu do card é. */}
      <p
        className="hidden items-center gap-1 text-sm text-muted-foreground pointer-coarse:flex"
        aria-hidden
      >
        Toque em
        <span className="inline-flex size-6 items-center justify-center rounded-md border bg-background">
          <MoreHorizontalIcon className="size-4" />
        </span>
        no card para mover o lead de etapa ou de posição.
      </p>

      <div className="flex gap-3 overflow-x-auto pb-3">
        {columns.map(({ stage, leads: columnLeads }) => (
          <KanbanColumn
            key={stage}
            stage={stage}
            leads={columnLeads}
            membersById={membersById}
            nowMs={nowMs}
            sla={sla}
            collapsible={COLLAPSED_BY_DEFAULT_STAGES.includes(stage)}
            collapsed={collapsed.has(stage)}
            draggingId={draggingId}
            dropIndex={dropTarget?.stage === stage ? dropTarget.index : null}
            focusId={focusId}
            canMove={canMove}
            onToggleCollapsed={() => setStageCollapsed(stage, !collapsed.has(stage))}
            onDragStartLead={setDraggingId}
            onDragEnd={finishDrag}
            onDragOverIndex={(index) =>
              setDropTarget((current) =>
                current?.stage === stage && current.index === index ? current : { stage, index }
              )
            }
            onDragLeaveColumn={() =>
              setDropTarget((current) => (current?.stage === stage ? null : current))
            }
            onDropLead={(leadId, index) => dropLead(stage, leadId, index)}
            onOpenLead={onOpenLead}
            onMoveLead={moveWithFocus}
            onStepStage={stepStage}
            onFocused={() => setFocusId(null)}
          />
        ))}
      </div>

      <p className="text-xs text-muted-foreground pointer-coarse:hidden" aria-hidden>
        Arraste os cards entre as colunas ou, com o nome do lead em foco, use <Kbd>Alt</Kbd> +{" "}
        <Kbd>←</Kbd> <Kbd>→</Kbd> para mudar a etapa e <Kbd>Alt</Kbd> + <Kbd>↑</Kbd> <Kbd>↓</Kbd>{" "}
        para mudar a ordem.
      </p>
    </div>
  )
}

type KanbanColumnProps = {
  stage: LeadStage
  leads: LeadItem[]
  membersById: ReadonlyMap<string, MemberOption>
  nowMs: number
  sla: LeadSlaSettings
  collapsible: boolean
  collapsed: boolean
  draggingId: string | null
  dropIndex: number | null
  focusId: string | null
  canMove: (lead: LeadItem) => boolean
  onToggleCollapsed: () => void
  onDragStartLead: (leadId: string) => void
  onDragEnd: () => void
  onDragOverIndex: (index: number) => void
  onDragLeaveColumn: () => void
  onDropLead: (leadId: string, index: number) => void
  onOpenLead: (leadId: string) => void
  onMoveLead: (lead: LeadItem, stage: LeadStage, index: number | null) => void
  onStepStage: (lead: LeadItem, delta: -1 | 1) => void
  onFocused: () => void
}

function KanbanColumn({
  stage,
  leads,
  membersById,
  nowMs,
  sla,
  collapsible,
  collapsed,
  draggingId,
  dropIndex,
  focusId,
  canMove,
  onToggleCollapsed,
  onDragStartLead,
  onDragEnd,
  onDragOverIndex,
  onDragLeaveColumn,
  onDropLead,
  onOpenLead,
  onMoveLead,
  onStepStage,
  onFocused,
}: KanbanColumnProps) {
  const label = LEAD_STAGE_LABELS[stage]
  const headingId = `leads-coluna-${stage}`
  const listId = `leads-coluna-${stage}-lista`

  function handleDragOver(event: React.DragEvent<HTMLElement>) {
    if (!draggingId) return

    event.preventDefault()
    event.dataTransfer.dropEffect = "move"
    onDragOverIndex(
      collapsed ? 0 : computeDropIndex(event.currentTarget, event.clientY, draggingId)
    )
  }

  function handleDragLeave(event: React.DragEvent<HTMLElement>) {
    const related = event.relatedTarget

    if (related instanceof Node && event.currentTarget.contains(related)) return

    onDragLeaveColumn()
  }

  function handleDrop(event: React.DragEvent<HTMLElement>) {
    event.preventDefault()

    const leadId = event.dataTransfer.getData("text/plain") || draggingId

    if (!leadId) return

    onDropLead(leadId, collapsed ? 0 : computeDropIndex(event.currentTarget, event.clientY, leadId))
  }

  const items: React.ReactNode[] = []
  let visibleIndex = 0
  let indicatorPlaced = false

  const indicator = (
    <li key="indicador" aria-hidden className="h-1 shrink-0 rounded-full bg-primary" />
  )

  leads.forEach((lead, position) => {
    const isDragging = lead.id === draggingId

    if (!isDragging) {
      if (dropIndex === visibleIndex && !indicatorPlaced) {
        items.push(indicator)
        indicatorPlaced = true
      }

      visibleIndex += 1
    }

    const movable = canMove(lead)

    items.push(
      <li
        key={lead.id}
        data-lead-card
        data-lead-id={lead.id}
        draggable={movable}
        onDragStart={(event) => {
          event.dataTransfer.effectAllowed = "move"
          event.dataTransfer.setData("text/plain", lead.id)
          onDragStartLead(lead.id)
        }}
        onDragEnd={onDragEnd}
        className={cn("transition-opacity", isDragging && "opacity-50")}
      >
        <LeadCard
          lead={lead}
          member={lead.assignedTo ? (membersById.get(lead.assignedTo) ?? null) : null}
          nowMs={nowMs}
          sla={sla}
          canMove={movable}
          isFirst={position === 0}
          isLast={position === leads.length - 1}
          autoFocus={focusId === lead.id}
          hintId={HINT_ID}
          onOpen={() => onOpenLead(lead.id)}
          onMoveStage={(target) => onMoveLead(lead, target, null)}
          onMoveBy={(delta) => onMoveLead(lead, stage, position + delta)}
          onStepStage={(delta) => onStepStage(lead, delta)}
          onFocused={onFocused}
        />
      </li>
    )
  })

  if (dropIndex !== null && !indicatorPlaced) {
    items.push(indicator)
  }

  const isDropTarget = dropIndex !== null

  return (
    <section
      aria-labelledby={headingId}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={cn(
        "flex shrink-0 flex-col gap-2 rounded-xl bg-muted/50 p-2 transition-shadow",
        collapsed ? "w-52" : "w-72",
        isDropTarget && "ring-2 ring-primary/40"
      )}
    >
      <header className="flex min-h-7 items-center justify-between gap-2 ps-1">
        <div className="flex min-w-0 items-center gap-2">
          <h2 id={headingId} className="truncate text-sm font-medium">
            {label}
          </h2>
          <Badge
            variant="secondary"
            className="tabular-nums"
            aria-label={`${leads.length} lead(s)`}
          >
            {leads.length}
          </Badge>
        </div>
        {collapsible ? (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-expanded={!collapsed}
            aria-controls={listId}
            onClick={onToggleCollapsed}
          >
            {collapsed ? <ChevronRightIcon /> : <ChevronDownIcon />}
            <span className="sr-only">
              {collapsed ? "Mostrar" : "Recolher"} a coluna {label}
            </span>
          </Button>
        ) : null}
      </header>

      {collapsed ? (
        <div
          id={listId}
          className="flex min-h-24 items-center justify-center rounded-lg border border-dashed p-3 text-center text-xs text-muted-foreground"
        >
          {draggingId
            ? `Solte aqui para mover para ${label}`
            : leads.length > 0
              ? "Coluna recolhida. Use a seta para ver os leads."
              : "Nenhum lead"}
        </div>
      ) : (
        <ol id={listId} aria-label={`Leads em ${label}`} className="flex min-h-24 flex-col gap-2">
          {items}
          {leads.length === 0 && dropIndex === null ? (
            <li className="flex min-h-20 items-center justify-center rounded-lg border border-dashed text-xs text-muted-foreground">
              Nenhum lead
            </li>
          ) : null}
        </ol>
      )}
    </section>
  )
}

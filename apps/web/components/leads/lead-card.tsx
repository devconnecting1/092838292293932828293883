"use client"

import * as React from "react"
import {
  ArrowDownIcon,
  ArrowUpIcon,
  GripVerticalIcon,
  MoreHorizontalIcon,
  PanelRightOpenIcon,
} from "lucide-react"

import { Avatar, AvatarFallback } from "@workspace/ui/components/avatar"
import { Button } from "@workspace/ui/components/button"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu"

import {
  LeadAdPlatformBadges,
  LeadDuplicateBadge,
  LeadRoutingBadges,
  LeadSourceBadge,
} from "@/components/leads/lead-badges"
import { getInitials } from "@/components/crm/utils"
import { formatDateTime } from "@/lib/format"
import type { MemberOption } from "@/lib/clientes/options"
import {
  getLeadInterestLabel,
  isLeadStage,
  LEAD_STAGE_LABELS,
  LEAD_STAGES,
} from "@/lib/leads/constants"
import type { LeadStage } from "@/lib/leads/db-types"
import { formatRelativeShort } from "@/lib/leads/format"
import type { LeadItem, LeadSlaSettings } from "@/lib/leads/types"

export type LeadCardProps = {
  lead: LeadItem
  member: MemberOption | null
  nowMs: number
  sla: LeadSlaSettings
  canMove: boolean
  isFirst: boolean
  isLast: boolean
  /** Recebe o foco ao montar (depois de mover pelo teclado ou menu). */
  autoFocus: boolean
  hintId: string
  onOpen: () => void
  onMoveStage: (stage: LeadStage) => void
  onMoveBy: (delta: -1 | 1) => void
  onStepStage: (delta: -1 | 1) => void
  onFocused: () => void
}

export function LeadCard({
  lead,
  member,
  nowMs,
  sla,
  canMove,
  isFirst,
  isLast,
  autoFocus,
  hintId,
  onOpen,
  onMoveStage,
  onMoveBy,
  onStepStage,
  onFocused,
}: LeadCardProps) {
  const buttonRef = React.useRef<HTMLButtonElement>(null)
  const interest = getLeadInterestLabel(lead.interest)
  const assigneeName = member?.name ?? (lead.assignedTo ? "Ex-membro" : "Sem responsável")

  React.useEffect(() => {
    if (autoFocus) {
      buttonRef.current?.focus()
    }
  }, [autoFocus])

  function handleKeyDown(event: React.KeyboardEvent<HTMLButtonElement>) {
    if (!canMove || !event.altKey) return

    const actions: Record<string, (() => void) | undefined> = {
      ArrowUp: isFirst ? undefined : () => onMoveBy(-1),
      ArrowDown: isLast ? undefined : () => onMoveBy(1),
      ArrowLeft: () => onStepStage(-1),
      ArrowRight: () => onStepStage(1),
    }
    const action = actions[event.key]

    if (action) {
      event.preventDefault()
      action()
    }
  }

  return (
    <Card size="sm" className={canMove ? "cursor-grab active:cursor-grabbing" : undefined}>
      <CardHeader>
        <CardTitle className="flex min-w-0 items-center gap-1">
          {canMove ? (
            <GripVerticalIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
          ) : null}
          <button
            ref={buttonRef}
            type="button"
            onClick={onOpen}
            onKeyDown={handleKeyDown}
            onFocus={onFocused}
            aria-describedby={canMove ? hintId : undefined}
            className="min-w-0 truncate rounded-sm text-start underline-offset-4 outline-hidden hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            {lead.name}
          </button>
        </CardTitle>
        <CardDescription className="flex min-w-0 flex-wrap items-center gap-1">
          <LeadSourceBadge lead={lead} />
          <LeadAdPlatformBadges platforms={lead.adPlatforms} />
        </CardDescription>
        <CardAction>
          <DropdownMenu>
            <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" />}>
              <MoreHorizontalIcon />
              <span className="sr-only">Ações do lead {lead.name}</span>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuGroup>
                <DropdownMenuItem onClick={onOpen}>
                  <PanelRightOpenIcon />
                  Ver detalhes
                </DropdownMenuItem>
              </DropdownMenuGroup>
              {canMove ? (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuGroup>
                    <DropdownMenuLabel>Mover para a etapa</DropdownMenuLabel>
                    <DropdownMenuRadioGroup
                      value={lead.stage}
                      onValueChange={(value) => {
                        if (isLeadStage(value) && value !== lead.stage) onMoveStage(value)
                      }}
                    >
                      {LEAD_STAGES.map((stage) => (
                        <DropdownMenuRadioItem key={stage} value={stage}>
                          {LEAD_STAGE_LABELS[stage]}
                        </DropdownMenuRadioItem>
                      ))}
                    </DropdownMenuRadioGroup>
                  </DropdownMenuGroup>
                  <DropdownMenuSeparator />
                  <DropdownMenuGroup>
                    <DropdownMenuItem disabled={isFirst} onClick={() => onMoveBy(-1)}>
                      <ArrowUpIcon />
                      Mover para cima
                    </DropdownMenuItem>
                    <DropdownMenuItem disabled={isLast} onClick={() => onMoveBy(1)}>
                      <ArrowDownIcon />
                      Mover para baixo
                    </DropdownMenuItem>
                  </DropdownMenuGroup>
                </>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        </CardAction>
      </CardHeader>

      <CardContent className="flex flex-col gap-2 text-xs">
        {/* `empty:hidden` some com a linha quando nenhum selo tem o que mostrar. */}
        <div className="flex flex-wrap gap-1 empty:hidden">
          <LeadRoutingBadges lead={lead} nowMs={nowMs} sla={sla} />
          <LeadDuplicateBadge hasDuplicate={lead.hasDuplicate} />
        </div>

        {lead.property || interest || lead.utm.campaign ? (
          <dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 text-muted-foreground">
            {lead.property ? (
              <>
                <dt>Imóvel</dt>
                <dd className="truncate font-mono text-foreground" title={lead.property.title}>
                  {lead.property.code}
                </dd>
              </>
            ) : null}
            {interest ? (
              <>
                <dt>Interesse</dt>
                <dd className="truncate text-foreground">{interest}</dd>
              </>
            ) : null}
            {lead.utm.campaign ? (
              <>
                <dt>Campanha</dt>
                <dd className="truncate text-foreground" title={lead.utm.campaign}>
                  {lead.utm.campaign}
                </dd>
              </>
            ) : null}
          </dl>
        ) : null}

        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-1.5">
            <Avatar size="sm">
              <AvatarFallback>{member ? getInitials(member.name) : "?"}</AvatarFallback>
            </Avatar>
            <span className="truncate text-muted-foreground">{assigneeName}</span>
          </div>
          <time
            dateTime={lead.createdAt}
            title={`Entrou em ${formatDateTime(lead.createdAt)}`}
            className="shrink-0 text-muted-foreground tabular-nums"
          >
            {formatRelativeShort(lead.createdAt, nowMs)}
          </time>
        </div>
      </CardContent>
    </Card>
  )
}

"use client"

import * as React from "react"
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react"

import type { PublicIncident, PublicStatusComponent } from "@workspace/core/status/public"
import { Button } from "@workspace/ui/components/button"
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@workspace/ui/components/popover"
import { cn } from "@workspace/ui/lib/utils"

import {
  formatDateKeyLong,
  formatUptime,
  getDayLevel,
  incidentAnchorId,
  pluralize,
} from "@/components/status/format"
import {
  getLevelLabel,
  STATUS_LEVEL_VISUALS,
  StatusLevelLabel,
} from "@/components/status/status-level"

/** Id do texto (único na página) que explica como navegar pelos dias. */
export const UPTIME_BAR_HINT_ID = "status-dias-dica"

/**
 * Quantos traços aparecem por largura de tela (os mais recentes): 30 no
 * celular, 60 a partir de 640 px e 90 a partir de 768 px. Os demais ficam com
 * display: none (fora da tela, do foco e do leitor de tela).
 */
export function visibleDayClass(index: number, total: number) {
  const fromEnd = total - index

  if (fromEnd > 60) {
    return "hidden md:block"
  }

  if (fromEnd > 30) {
    return "hidden sm:block"
  }

  return "block"
}

function isShown(element: Element | null | undefined) {
  return !!element && element.getClientRects().length > 0
}

function describeDay(day: PublicStatusComponent["days"][number]) {
  const level = getDayLevel(day)
  const parts = [formatDateKeyLong(day.date), getLevelLabel(level)]

  if (day.uptimePct !== null) {
    parts.push(`${formatUptime(day.uptimePct)} disponível`)
  }

  if (day.incidentIds.length > 0) {
    parts.push(pluralize(day.incidentIds.length, "incidente", "incidentes"))
  }

  return parts.join(", ")
}

/**
 * Barra de disponibilidade de uma parte do sistema: um traço por dia, cor pelo
 * pior nível do dia, cinza sem medição. Um único ponto de parada no Tab (setas,
 * Home e End mudam o dia); Enter, clique ou passar o mouse abre o detalhe do
 * dia, com os incidentes (links para a âncora na página) e botões grandes de
 * dia anterior/próximo para quem usa o toque.
 */
export const UptimeBar = React.memo(function UptimeBar({
  component,
  incidentsById,
}: {
  component: PublicStatusComponent
  incidentsById: ReadonlyMap<string, PublicIncident>
}) {
  const baseId = React.useId()
  const groupRef = React.useRef<HTMLDivElement>(null)
  const closingToAnchor = React.useRef(false)
  const { days } = component
  const lastIndex = days.length - 1
  const [focusIndex, setFocusIndex] = React.useState(lastIndex)
  const [open, setOpen] = React.useState(false)
  const [activeIndex, setActiveIndex] = React.useState<number | null>(null)
  // Primeiro e último dia visíveis na largura atual, lidos ao abrir o detalhe.
  const [visibleBounds, setVisibleBounds] = React.useState({ first: 0, last: lastIndex })
  const activeDay = activeIndex === null ? undefined : days[activeIndex]
  const triggerId = (index: number) => `${baseId}-dia-${index}`

  /** Dias visíveis na largura atual, na ordem da barra. */
  function visibleIndexes() {
    const buttons = groupRef.current?.querySelectorAll<HTMLElement>("[data-day-index]") ?? []
    return Array.from(buttons)
      .filter((button) => isShown(button))
      .map((button) => Number(button.dataset.dayIndex))
  }

  function adjacentIndex(from: number, step: -1 | 1) {
    const visible = visibleIndexes()
    const position = visible.indexOf(from)
    return position === -1 ? undefined : visible[position + step]
  }

  function focusDay(index: number | undefined) {
    if (index === undefined) {
      return
    }

    setFocusIndex(index)
    document.getElementById(triggerId(index))?.focus()
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    const target = event.target as HTMLElement
    const current = Number(target.dataset.dayIndex)

    if (!Number.isInteger(current)) {
      return
    }

    const visible = visibleIndexes()
    const moves: Record<string, number | undefined> = {
      ArrowLeft: adjacentIndex(current, -1),
      ArrowRight: adjacentIndex(current, 1),
      Home: visible[0],
      End: visible[visible.length - 1],
    }

    if (event.key in moves) {
      event.preventDefault()
      focusDay(moves[event.key])
    }
  }

  const previousIndex =
    activeIndex !== null && activeIndex > visibleBounds.first ? activeIndex - 1 : undefined
  const nextIndex =
    activeIndex !== null && activeIndex < visibleBounds.last ? activeIndex + 1 : undefined

  return (
    <Popover
      open={open}
      triggerId={activeIndex === null ? null : triggerId(activeIndex)}
      onOpenChange={(nextOpen, details) => {
        const index = Number((details.trigger as HTMLElement | undefined)?.dataset.dayIndex)

        if (nextOpen && Number.isInteger(index)) {
          const visible = visibleIndexes()
          setVisibleBounds({
            first: visible[0] ?? 0,
            last: visible[visible.length - 1] ?? lastIndex,
          })
          setActiveIndex(index)
        }

        setOpen(nextOpen)
      }}
    >
      <div
        ref={groupRef}
        role="group"
        aria-label={`Disponibilidade de ${component.name} por dia`}
        aria-describedby={UPTIME_BAR_HINT_ID}
        className="flex h-9 items-stretch gap-px sm:gap-0.5"
        onKeyDown={onKeyDown}
        onBlur={(event) => {
          // Fora da barra, o ponto de parada volta para hoje (sempre visível).
          if (!event.currentTarget.contains(event.relatedTarget)) {
            setFocusIndex(lastIndex)
          }
        }}
      >
        {days.map((day, index) => {
          const level = getDayLevel(day)

          return (
            <PopoverTrigger
              key={day.date}
              id={triggerId(index)}
              data-day-index={index}
              openOnHover
              delay={60}
              closeDelay={60}
              tabIndex={index === focusIndex ? 0 : -1}
              aria-label={describeDay(day)}
              onFocus={() => setFocusIndex(index)}
              className={cn(
                visibleDayClass(index, days.length),
                "min-w-0 flex-1 rounded-[2px] outline-none",
                "transition-opacity hover:opacity-75 motion-reduce:transition-none",
                "focus-visible:ring-3 focus-visible:ring-ring/60 focus-visible:ring-offset-1",
                "data-popup-open:ring-2 data-popup-open:ring-foreground data-popup-open:ring-offset-1",
                STATUS_LEVEL_VISUALS[level].fill
              )}
            />
          )
        })}
      </div>
      <PopoverContent
        side="top"
        className="w-72 max-w-[calc(100vw-2rem)]"
        finalFocus={() => {
          if (closingToAnchor.current) {
            closingToAnchor.current = false
            return false
          }

          return true
        }}
      >
        {activeDay ? (
          <>
            <PopoverHeader>
              <PopoverTitle>{formatDateKeyLong(activeDay.date)}</PopoverTitle>
              <PopoverDescription>{component.name}</PopoverDescription>
            </PopoverHeader>
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
              <StatusLevelLabel level={getDayLevel(activeDay)} />
              <span className="text-sm text-muted-foreground tabular-nums">
                {activeDay.uptimePct === null
                  ? "Sem medição automática"
                  : `${formatUptime(activeDay.uptimePct)} disponível`}
              </span>
            </div>
            <DayIncidents
              incidentIds={activeDay.incidentIds}
              incidentsById={incidentsById}
              onNavigate={(anchorId) => {
                closingToAnchor.current = true
                setOpen(false)
                // Depois do salto da âncora, o foco vai para o incidente.
                requestAnimationFrame(() => document.getElementById(anchorId)?.focus())
              }}
            />
            <div className="flex items-center justify-between gap-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={previousIndex === undefined}
                onClick={() => previousIndex !== undefined && setActiveIndex(previousIndex)}
              >
                <ChevronLeftIcon data-icon="inline-start" />
                Dia anterior
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={nextIndex === undefined}
                onClick={() => nextIndex !== undefined && setActiveIndex(nextIndex)}
              >
                Próximo dia
                <ChevronRightIcon data-icon="inline-end" />
              </Button>
            </div>
          </>
        ) : null}
      </PopoverContent>
    </Popover>
  )
})

function DayIncidents({
  incidentIds,
  incidentsById,
  onNavigate,
}: {
  incidentIds: readonly string[]
  incidentsById: ReadonlyMap<string, PublicIncident>
  onNavigate: (anchorId: string) => void
}) {
  if (incidentIds.length === 0) {
    return <p className="text-sm text-muted-foreground">Nenhum incidente neste dia.</p>
  }

  const known = incidentIds.flatMap((id) => {
    const incident = incidentsById.get(id)
    return incident ? [incident] : []
  })
  const unknownCount = incidentIds.length - known.length

  return (
    <div className="flex flex-col gap-1">
      {known.length > 0 ? (
        <ul className="flex flex-col gap-1">
          {known.map((incident) => {
            const anchorId = incidentAnchorId(incident.id)

            return (
              <li key={incident.id} className="text-sm">
                <a
                  href={`#${anchorId}`}
                  className="underline underline-offset-3 hover:text-muted-foreground"
                  onClick={() => onNavigate(anchorId)}
                >
                  {incident.title}
                </a>
              </li>
            )
          })}
        </ul>
      ) : null}
      {unknownCount > 0 ? (
        <p className="text-sm text-muted-foreground">
          {pluralize(unknownCount, "incidente registrado", "incidentes registrados")}. A página
          detalha só os últimos 14 dias.
        </p>
      ) : null}
    </div>
  )
}

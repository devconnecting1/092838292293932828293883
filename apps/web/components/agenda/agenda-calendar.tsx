"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { ptBR } from "react-day-picker/locale"

import { Button } from "@workspace/ui/components/button"
import { Calendar } from "@workspace/ui/components/calendar"
import { Spinner } from "@workspace/ui/components/spinner"

import { dateKeyToLocalDate, localDateToDateKey } from "@/lib/agenda/datetime"
import { buildAgendaHref } from "@/lib/agenda/url"

type AgendaCalendarProps = {
  /** Dia selecionado ("AAAA-MM-DD", Brasília). */
  day: string
  /** Mês exibido ("AAAA-MM"). */
  month: string
  broker: string | null
  /** Hoje em Brasília, calculado no servidor. */
  todayKey: string
  /** Dias com visitas, calculados no servidor com o fuso de Brasília. */
  visitDays: string[]
  overdueDays: string[]
}

// Ponto sob o número do dia; acima do botão para aparecer também no dia selecionado.
const DOT_CLASS =
  "after:pointer-events-none after:absolute after:bottom-1 after:inset-s-1/2 after:z-20 after:size-1 after:-translate-x-1/2 after:rounded-full data-[selected=true]:after:bg-primary-foreground"

/** Calendário do mês: trocar dia ou mês atualiza a URL (?dia=&mes=). */
export function AgendaCalendar({
  day,
  month,
  broker,
  todayKey,
  visitDays,
  overdueDays,
}: AgendaCalendarProps) {
  const router = useRouter()
  const [isPending, startTransition] = React.useTransition()
  const [view, setOptimisticView] = React.useOptimistic({ day, month })

  const visitSet = new Set(visitDays)
  const overdueSet = new Set(overdueDays)

  function navigate(next: { day: string; month: string }) {
    startTransition(() => {
      setOptimisticView(next)
      router.push(buildAgendaHref({ ...next, broker }), { scroll: false })
    })
  }

  return (
    <div className="flex flex-col gap-3">
      <Calendar
        mode="single"
        required
        locale={ptBR}
        className="mx-auto [--cell-size:--spacing(9)]"
        today={dateKeyToLocalDate(todayKey)}
        selected={dateKeyToLocalDate(view.day)}
        month={dateKeyToLocalDate(`${view.month}-01`)}
        onMonthChange={(date) => {
          navigate({
            day: view.day,
            month: localDateToDateKey(date).slice(0, 7),
          })
        }}
        onSelect={(date) => {
          const dateKey = localDateToDateKey(date)
          navigate({ day: dateKey, month: dateKey.slice(0, 7) })
        }}
        modifiers={{
          hasVisit: (date) => {
            const dateKey = localDateToDateKey(date)
            return visitSet.has(dateKey) && !overdueSet.has(dateKey)
          },
          overdue: (date) => overdueSet.has(localDateToDateKey(date)),
        }}
        modifiersClassNames={{
          hasVisit: `${DOT_CLASS} after:bg-primary`,
          overdue: `${DOT_CLASS} after:bg-destructive`,
        }}
      />
      <div className="flex flex-wrap items-center justify-between gap-2 px-1">
        <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <span aria-hidden className="size-1.5 rounded-full bg-primary" />
            Com visitas
          </span>
          <span className="flex items-center gap-1.5">
            <span aria-hidden className="size-1.5 rounded-full bg-destructive" />
            Sem retorno
          </span>
        </div>
        <Button
          variant="outline"
          size="sm"
          disabled={isPending || (view.day === todayKey && view.month === todayKey.slice(0, 7))}
          onClick={() => navigate({ day: todayKey, month: todayKey.slice(0, 7) })}
        >
          {isPending ? <Spinner data-icon="inline-start" /> : null}
          Hoje
        </Button>
      </div>
    </div>
  )
}

"use client"

import * as React from "react"
import { useRouter } from "next/navigation"

import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select"
import { Spinner } from "@workspace/ui/components/spinner"

import { getVisitBrokers } from "@/lib/agenda/labels"
import { buildAgendaHref } from "@/lib/agenda/url"
import type { MemberOption } from "@/lib/clientes/options"

type AgendaBrokerFilterProps = {
  members: MemberOption[]
  broker: string | null
  day: string
  month: string
}

/** Filtro por corretor (só para quem vê a agenda da equipe). */
export function AgendaBrokerFilter({ members, broker, day, month }: AgendaBrokerFilterProps) {
  const router = useRouter()
  const [isPending, startTransition] = React.useTransition()
  const [selected, setOptimisticSelected] = React.useOptimistic(broker)

  const items = [
    { label: "Todos os corretores", value: null as string | null },
    ...getVisitBrokers(members).map((member) => ({
      label: member.name,
      value: member.id as string | null,
    })),
  ]

  if (selected && !items.some((item) => item.value === selected)) {
    items.push({ label: "Ex-membro", value: selected })
  }

  return (
    <div className="flex items-center gap-2">
      {isPending ? <Spinner className="text-muted-foreground" /> : null}
      <Select
        items={items}
        value={selected}
        onValueChange={(value) => {
          startTransition(() => {
            setOptimisticSelected(value)
            router.push(buildAgendaHref({ day, month, broker: value }), {
              scroll: false,
            })
          })
        }}
      >
        <SelectTrigger className="w-full sm:w-60" aria-label="Filtrar por corretor">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            {items.map((item) => (
              <SelectItem key={item.value ?? "todos"} value={item.value}>
                {item.label}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
    </div>
  )
}

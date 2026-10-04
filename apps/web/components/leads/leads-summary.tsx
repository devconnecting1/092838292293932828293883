import { CalendarDaysIcon, InboxIcon, TimerIcon, TrophyIcon } from "lucide-react"
import type { LucideIcon } from "lucide-react"
import { cn } from "cn"

import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
} from "@workspace/ui/components/card"

import { LeadsPhoneDefaultView } from "@/components/leads/leads-table"
import type { LeadSummaryCounts } from "@/lib/leads/types"

const percent = new Intl.NumberFormat("pt-BR", {
  style: "percent",
  maximumFractionDigits: 1,
})
const integer = new Intl.NumberFormat("pt-BR")

type LeadsSummaryProps = {
  counts: LeadSummaryCounts
  wonCount: number
  totalCount: number
  periodLabel: string
  /** Prazo de primeiro contato configurado pela imobiliária. */
  slaMinutes: number
}

function SummaryCard({
  label,
  value,
  hint,
  icon: Icon,
  highlight,
}: {
  label: string
  value: string
  hint: string
  icon: LucideIcon
  highlight?: boolean
}) {
  return (
    <Card size="sm">
      <CardHeader>
        <CardDescription>{label}</CardDescription>
        <CardAction>
          <Icon
            aria-hidden
            className={cn("size-4 text-muted-foreground", highlight && "text-destructive")}
          />
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-1">
        <p
          className={cn(
            "text-xl font-semibold tabular-nums sm:text-2xl",
            highlight && "text-destructive"
          )}
        >
          {value}
        </p>
        {/* No celular (grade 2×2) a explicação fica só para leitor de tela. */}
        <p className="text-xs text-muted-foreground max-sm:sr-only">{hint}</p>
      </CardContent>
    </Card>
  )
}

/** Resumo do topo: prazo de primeiro contato, novos sem contato, leads de hoje e conversão. */
export function LeadsSummary({
  counts,
  wonCount,
  totalCount,
  periodLabel,
  slaMinutes,
}: LeadsSummaryProps) {
  const show = (value: number) => (counts.failed ? "—" : integer.format(value))

  return (
    <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
      {/* O resumo aparece em toda visita a /leads: daqui sai o padrão do celular. */}
      <LeadsPhoneDefaultView />
      <SummaryCard
        label="Leads fora do prazo"
        value={show(counts.overdue)}
        hint={`Sem primeiro contato registrado em ${slaMinutes} min (mudar a etapa não conta).`}
        icon={TimerIcon}
        highlight={!counts.failed && counts.overdue > 0}
      />
      <SummaryCard
        label="Leads novos sem contato"
        value={show(counts.newWithoutContact)}
        hint="Na etapa Novo, aguardando o primeiro contato."
        icon={InboxIcon}
      />
      <SummaryCard
        label="Leads de hoje"
        value={show(counts.today)}
        hint="Entraram desde 00:00 (horário de Brasília)."
        icon={CalendarDaysIcon}
      />
      <SummaryCard
        label="Taxa de conversão"
        value={totalCount > 0 ? percent.format(wonCount / totalCount) : "—"}
        hint={`${integer.format(wonCount)} ganho(s) de ${integer.format(totalCount)} lead(s) · ${periodLabel.toLocaleLowerCase("pt-BR")}.`}
        icon={TrophyIcon}
      />
    </div>
  )
}

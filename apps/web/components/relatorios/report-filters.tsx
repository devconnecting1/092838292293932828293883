"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { FilterXIcon, LockIcon } from "lucide-react"

import {
  DEFAULT_REPORT_PERIOD_PRESET,
  isReportPeriodPreset,
  REPORT_PERIOD_PRESET_LABELS,
  REPORT_PERIOD_PRESETS,
  type ReportPeriod,
} from "@workspace/core/reports/period"
import { Button } from "@workspace/ui/components/button"
import { Field, FieldGroup, FieldLabel } from "@workspace/ui/components/field"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select"
import { Spinner } from "@workspace/ui/components/spinner"

import { DatePicker } from "@/components/agenda/date-picker"
import type { ReportAccess } from "@/lib/relatorios/permissions"
import { buildReportHref, tabUsesPeriod, type ReportTab } from "@/lib/relatorios/url"

/** Valor do select quando as datas foram escolhidas à mão. */
const CUSTOM = "personalizado"
const ALL = "todos"

export type ReportFilterTeam = {
  id: string
  name: string
  memberIds: readonly string[]
}

export type ReportFilterMember = {
  id: string
  name: string
}

type ReportFiltersProps = {
  period: ReportPeriod
  broker: string | null
  team: string | null
  /** Mês da aba Metas ("AAAA-MM"). */
  month: string
  monthOptions: readonly { value: string; label: string }[]
  isCurrentMonth: boolean
  tab: ReportTab
  access: ReportAccess
  /** Equipes que quem olha pode escolher (todas para a gestão; as lideradas para o líder). */
  teams: readonly ReportFilterTeam[]
  /** Corretores que quem olha pode escolher. Vazio para quem vê só o próprio número. */
  members: readonly ReportFilterMember[]
  /** Nome de quem está olhando, para o campo travado dizer de quem é o número. */
  selfName: string
}

/**
 * Filtro de período, equipe, corretor e mês. Tudo viaja na URL (`?periodo=`,
 * `?de=`, `?ate=`, `?equipe=`, `?corretor=`, `?mes=`), então o relatório é um
 * link que se manda para o sócio — e a exportação usa exatamente os mesmos
 * parâmetros.
 *
 * Quem vê só o próprio número tem o campo de corretor TRAVADO com o próprio
 * nome, em vez de sumir: a tela diz o recorte em que está, que é o que o banco
 * vai aplicar de qualquer jeito. O líder escolhe só dentro das equipes que
 * lidera.
 */
export function ReportFilters({
  period,
  broker,
  team,
  month,
  monthOptions,
  isCurrentMonth,
  tab,
  access,
  teams,
  members,
  selfName,
}: ReportFiltersProps) {
  const router = useRouter()
  const [isPending, startTransition] = React.useTransition()
  // Estado local só do modo "personalizado" e das duas datas enquanto o usuário
  // escolhe a segunda. Quem sincroniza com a URL é o `key` do componente, em
  // page.tsx: período diferente remonta o filtro e o estado nasce do novo
  // período — sem efeito copiando prop para estado.
  const [custom, setCustom] = React.useState(period.preset === null)
  const [fromDay, setFromDay] = React.useState(period.fromDay)
  const [toDay, setToDay] = React.useState(period.toDay)

  const usesPeriod = tabUsesPeriod(tab)
  const canChooseBroker = access !== "self"
  const canChooseTeam = access !== "self" && teams.length > 0

  const current = {
    preset: period.preset,
    from: period.fromDay,
    to: period.toDay,
    broker,
    team,
    month,
    tab,
  }

  function navigate(href: string) {
    startTransition(() => {
      router.replace(href, { scroll: false })
    })
  }

  function applyPeriod(nextFrom: string, nextTo: string) {
    if (!nextFrom || !nextTo) {
      return
    }

    navigate(buildReportHref({ ...current, preset: null, from: nextFrom, to: nextTo }))
  }

  const periodValue = period.preset ?? CUSTOM
  const periodItems = [
    ...REPORT_PERIOD_PRESETS.map((preset) => ({
      value: preset as string,
      label: REPORT_PERIOD_PRESET_LABELS[preset],
    })),
    { value: CUSTOM, label: "Período personalizado" },
  ]

  const selectedTeam = team ? teams.find((item) => item.id === team) : undefined

  const teamItems = [
    { value: ALL, label: access === "leader" ? "Todas as minhas equipes" : "Todas as equipes" },
    ...teams.map((item) => ({ value: item.id, label: item.name })),
  ]

  if (team && !selectedTeam) {
    teamItems.push({ value: team, label: "Equipe fora do seu acesso" })
  }

  // Com equipe escolhida, o corretor sai da equipe (o banco cruza os dois filtros).
  const brokerChoices = selectedTeam
    ? members.filter((member) => selectedTeam.memberIds.includes(member.id))
    : members

  const brokerItems = [
    {
      value: ALL,
      label: selectedTeam
        ? "Toda a equipe"
        : access === "leader"
          ? "Todos das minhas equipes"
          : "Toda a imobiliária",
    },
    ...brokerChoices.map((member) => ({ value: member.id, label: member.name })),
  ]

  if (broker && !brokerItems.some((item) => item.value === broker)) {
    brokerItems.push({ value: broker, label: "Ex-membro ou fora da equipe" })
  }

  const hasFilters =
    (usesPeriod && period.preset !== DEFAULT_REPORT_PERIOD_PRESET) ||
    Boolean(broker) ||
    Boolean(team) ||
    (tab === "metas" && !isCurrentMonth)

  return (
    <FieldGroup className="gap-4 @2xl/page:flex-row @2xl/page:flex-wrap @2xl/page:items-end">
      {usesPeriod ? (
        <Field className="@2xl/page:w-56">
          <FieldLabel htmlFor="relatorio-periodo">Período</FieldLabel>
          <Select
            items={periodItems}
            value={periodValue}
            onValueChange={(value) => {
              if (value === CUSTOM) {
                setCustom(true)
                return
              }

              if (isReportPeriodPreset(value)) {
                setCustom(false)
                navigate(buildReportHref({ ...current, preset: value }))
              }
            }}
          >
            <SelectTrigger id="relatorio-periodo" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {periodItems.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </Field>
      ) : null}

      {usesPeriod && custom ? (
        <>
          <Field className="@2xl/page:w-44">
            <FieldLabel htmlFor="relatorio-de">De</FieldLabel>
            <DatePicker
              id="relatorio-de"
              value={fromDay}
              onChange={(value) => {
                setFromDay(value)
                applyPeriod(value, toDay)
              }}
            />
          </Field>
          <Field className="@2xl/page:w-44">
            <FieldLabel htmlFor="relatorio-ate">Até</FieldLabel>
            <DatePicker
              id="relatorio-ate"
              value={toDay}
              onChange={(value) => {
                setToDay(value)
                applyPeriod(fromDay, value)
              }}
            />
          </Field>
        </>
      ) : null}

      {tab === "metas" ? (
        <Field className="@2xl/page:w-56">
          <FieldLabel htmlFor="relatorio-mes">Mês</FieldLabel>
          <Select
            items={[...monthOptions]}
            value={month}
            onValueChange={(value) => {
              if (typeof value === "string") {
                navigate(buildReportHref({ ...current, month: value }))
              }
            }}
          >
            <SelectTrigger id="relatorio-mes" className="w-full capitalize">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {monthOptions.map((item) => (
                  <SelectItem key={item.value} value={item.value} className="capitalize">
                    {item.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </Field>
      ) : null}

      {canChooseTeam ? (
        <Field className="@2xl/page:w-56">
          <FieldLabel htmlFor="relatorio-equipe">Equipe</FieldLabel>
          <Select
            items={teamItems}
            value={team ?? ALL}
            onValueChange={(value) => {
              const nextTeam = value === ALL ? null : String(value)
              const nextTeamData = nextTeam ? teams.find((item) => item.id === nextTeam) : undefined
              // Corretor de outra equipe sai do filtro, para o recorte não virar "ninguém".
              const keepBroker =
                broker && (!nextTeamData || nextTeamData.memberIds.includes(broker)) ? broker : null

              navigate(buildReportHref({ ...current, team: nextTeam, broker: keepBroker }))
            }}
          >
            <SelectTrigger id="relatorio-equipe" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {teamItems.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </Field>
      ) : null}

      <Field className="@2xl/page:w-60">
        <FieldLabel htmlFor="relatorio-corretor">Corretor</FieldLabel>
        {canChooseBroker ? (
          <Select
            items={brokerItems}
            value={broker ?? ALL}
            onValueChange={(value) => {
              const next = value === ALL ? null : String(value)
              navigate(buildReportHref({ ...current, broker: next }))
            }}
          >
            <SelectTrigger id="relatorio-corretor" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {brokerItems.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        ) : (
          <div
            id="relatorio-corretor"
            className="flex h-9 w-full items-center gap-2 rounded-md border border-input bg-muted/40 px-3 text-sm text-muted-foreground"
          >
            <LockIcon className="size-4 shrink-0" aria-hidden />
            <span className="truncate">{selfName}</span>
          </div>
        )}
      </Field>

      <div className="flex items-center gap-2 @2xl/page:pb-0.5">
        {isPending ? <Spinner className="text-muted-foreground" /> : null}
        {hasFilters ? (
          <Button
            type="button"
            variant="ghost"
            onClick={() => navigate(buildReportHref({ preset: DEFAULT_REPORT_PERIOD_PRESET, tab }))}
          >
            <FilterXIcon data-icon="inline-start" />
            Limpar
          </Button>
        ) : null}
      </div>
    </FieldGroup>
  )
}

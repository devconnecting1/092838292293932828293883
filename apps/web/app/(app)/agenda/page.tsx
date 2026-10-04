import type { Metadata } from "next"
import { CalendarDaysIcon, PlusIcon, TriangleAlertIcon } from "lucide-react"

import { Alert, AlertDescription, AlertTitle } from "@workspace/ui/components/alert"
import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@workspace/ui/components/empty"
import { ItemGroup } from "@workspace/ui/components/item"

import { AgendaBrokerFilter } from "@/components/agenda/agenda-broker-filter"
import { AgendaCalendar } from "@/components/agenda/agenda-calendar"
import { AppointmentCard, PendingAppointmentItem } from "@/components/agenda/appointment-card"
import { AppointmentFormDialog } from "@/components/agenda/appointment-form-dialog"
import { PageHeading } from "@/components/crm/page-placeholder"
import { PageShell } from "@/components/shared/page-shell"
import { formatDateKey, formatMonthKey, toDateKey } from "@/lib/agenda/datetime"
import { canScheduleAppointments, canViewAllAppointments } from "@/lib/agenda/permissions"
import { getAgendaData } from "@/lib/agenda/queries"
import { parseAgendaSearchParams } from "@/lib/agenda/url"
import { requireMembership } from "@/lib/auth/session"
import { getOrganizationMembers } from "@/lib/clientes/members"

export const metadata: Metadata = {
  title: "Agenda",
}

type AgendaPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

const countFormat = new Intl.PluralRules("pt-BR")

function formatVisitCount(count: number) {
  if (count === 0) return "Nenhuma visita"
  return `${count} ${countFormat.select(count) === "one" ? "visita" : "visitas"}`
}

export default async function AgendaPage({ searchParams }: AgendaPageProps) {
  const [{ user, membership }, params] = await Promise.all([requireMembership(), searchParams])

  const now = new Date()
  const todayKey = toDateKey(now)
  const view = parseAgendaSearchParams(params, todayKey)
  const { organizationId, role } = membership
  const viewAll = canViewAllAppointments(role)
  const canSchedule = canScheduleAppointments(role)
  // Quem não vê a equipe enxerga sempre a própria agenda.
  const brokerFilter = viewAll ? view.broker : user.id

  const [members, agenda] = await Promise.all([
    getOrganizationMembers(organizationId),
    getAgendaData({
      organizationId,
      brokerId: brokerFilter,
      day: view.day,
      month: view.month,
      now,
    }),
  ])

  const isToday = view.day === todayKey
  const viewProps = { members, currentUserId: user.id, role }

  return (
    <PageShell>
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <PageHeading
          title="Agenda"
          description={
            viewAll
              ? "Visitas por corretor, com o retorno do cliente depois de cada visita."
              : "Suas visitas, com o retorno do cliente depois de cada visita."
          }
        />
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          {viewAll ? (
            <AgendaBrokerFilter
              members={members}
              broker={view.broker}
              day={view.day}
              month={view.month}
            />
          ) : null}
          {canSchedule ? (
            <AppointmentFormDialog
              {...viewProps}
              defaults={{ dateKey: view.day }}
              trigger={<Button />}
            >
              <PlusIcon data-icon="inline-start" />
              Nova visita
            </AppointmentFormDialog>
          ) : null}
        </div>
      </div>

      {agenda.failed ? (
        <Alert variant="destructive">
          <TriangleAlertIcon />
          <AlertTitle>Parte da agenda não carregou</AlertTitle>
          <AlertDescription>
            Recarregue a página. Se continuar, tente novamente mais tarde.
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="grid items-start gap-6 lg:grid-cols-[20rem_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-6">
          <Card size="sm">
            <CardHeader>
              <CardTitle>Calendário</CardTitle>
              <CardDescription className="first-letter:uppercase">
                {formatMonthKey(view.month)}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <AgendaCalendar
                day={view.day}
                month={view.month}
                broker={view.broker}
                todayKey={todayKey}
                visitDays={agenda.visitDays}
                overdueDays={agenda.overdueDays}
              />
            </CardContent>
          </Card>

          {agenda.pending.length > 0 ? (
            <Card size="sm">
              <CardHeader>
                <CardTitle>Pendentes de retorno</CardTitle>
                <CardDescription>Visitas passadas sem registro do que aconteceu.</CardDescription>
                <CardAction>
                  <Badge variant="destructive">{agenda.pendingTotal}</Badge>
                </CardAction>
              </CardHeader>
              <CardContent>
                <ItemGroup className="gap-2">
                  {agenda.pending.map((appointment) => (
                    <PendingAppointmentItem
                      key={appointment.id}
                      appointment={appointment}
                      broker={view.broker}
                      showBroker={viewAll && !view.broker}
                      {...viewProps}
                    />
                  ))}
                </ItemGroup>
              </CardContent>
              {agenda.pendingTotal > agenda.pending.length ? (
                <CardFooter className="text-muted-foreground">
                  Mostrando as {agenda.pending.length} mais antigas de {agenda.pendingTotal}.
                </CardFooter>
              ) : null}
            </Card>
          ) : null}
        </div>

        <section aria-labelledby="agenda-day-title" className="flex min-w-0 flex-col gap-4">
          <div className="flex flex-col gap-1">
            <h2 id="agenda-day-title" className="text-lg font-semibold first-letter:uppercase">
              {formatDateKey(view.day, "weekday")}
            </h2>
            <p className="text-sm text-muted-foreground">
              {formatVisitCount(agenda.dayAppointments.length)}
              {isToday ? " · hoje" : null}
            </p>
          </div>

          {agenda.dayAppointments.length > 0 ? (
            <div className="flex flex-col gap-4">
              {agenda.dayAppointments.map((appointment) => (
                <AppointmentCard key={appointment.id} appointment={appointment} {...viewProps} />
              ))}
            </div>
          ) : (
            <Empty className="border">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <CalendarDaysIcon />
                </EmptyMedia>
                <EmptyTitle>Nenhuma visita neste dia</EmptyTitle>
                <EmptyDescription>
                  {viewAll && view.broker
                    ? "O corretor selecionado não tem visitas nesta data."
                    : "Escolha outro dia no calendário ou agende uma nova visita."}
                </EmptyDescription>
              </EmptyHeader>
              {canSchedule ? (
                <EmptyContent>
                  <AppointmentFormDialog
                    {...viewProps}
                    defaults={{ dateKey: view.day }}
                    trigger={<Button variant="outline" />}
                  >
                    <PlusIcon data-icon="inline-start" />
                    Agendar visita
                  </AppointmentFormDialog>
                </EmptyContent>
              ) : null}
            </Empty>
          )}
        </section>
      </div>
    </PageShell>
  )
}

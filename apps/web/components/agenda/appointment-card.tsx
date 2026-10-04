import Link from "next/link"
import { HouseIcon, MapPinIcon, StarIcon, UserIcon } from "lucide-react"

import { Badge } from "@workspace/ui/components/badge"
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
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemTitle,
} from "@workspace/ui/components/item"

import { AddToCalendarButton } from "@/components/agenda/add-to-calendar-button"
import { AppointmentActions } from "@/components/agenda/appointment-actions"
import { AppointmentStatusBadge } from "@/components/agenda/appointment-status-badge"
import { formatDateKey } from "@/lib/agenda/datetime"
import { formatPropertyLabel } from "@/lib/agenda/labels"
import type { AgendaAppointment } from "@/lib/agenda/types"
import { buildAgendaHref } from "@/lib/agenda/url"
import type { Role } from "@/lib/auth/roles"
import { getMemberName, type MemberOption } from "@/lib/clientes/options"
import { formatTime } from "@/lib/format"

type AppointmentViewProps = {
  appointment: AgendaAppointment
  members: MemberOption[]
  currentUserId: string
  role: Role
}

function formatTimeRange(appointment: AgendaAppointment) {
  const start = formatTime(appointment.startsAt)
  return appointment.endsAt ? `${start}–${formatTime(appointment.endsAt)}` : start
}

function clientLabel(appointment: AgendaAppointment) {
  if (appointment.client) return appointment.client.name
  return appointment.clientId ? "Cliente sem acesso" : null
}

/** Visita na lista do dia. */
export function AppointmentCard({
  appointment,
  members,
  currentUserId,
  role,
}: AppointmentViewProps) {
  const { property, client } = appointment
  const hasReturn =
    appointment.status === "done" && (appointment.rating !== null || Boolean(appointment.feedback))
  const isUpcoming =
    (appointment.status === "scheduled" || appointment.status === "confirmed") &&
    !appointment.overdue

  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          <span className="tabular-nums">{formatTimeRange(appointment)}</span>
          <AppointmentStatusBadge status={appointment.status} overdue={appointment.overdue} />
        </CardTitle>
        <CardDescription>
          Corretor: {getMemberName(members, appointment.brokerId, "sem corretor")}
        </CardDescription>
        <CardAction>
          <AppointmentActions
            appointment={appointment}
            members={members}
            currentUserId={currentUserId}
            role={role}
          />
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-x-3 gap-y-2">
          <dt className="flex h-5 items-center text-muted-foreground">
            <HouseIcon aria-hidden className="size-4" />
            <span className="sr-only">Imóvel</span>
          </dt>
          <dd className="flex flex-col">
            {property ? (
              <>
                <Link
                  href={`/imoveis/${property.id}`}
                  className="font-medium underline-offset-4 hover:underline"
                >
                  {formatPropertyLabel(property)}
                </Link>
                {property.neighborhood ? (
                  <span className="text-muted-foreground">{property.neighborhood}</span>
                ) : null}
              </>
            ) : (
              <span className="text-muted-foreground">Imóvel indisponível</span>
            )}
          </dd>

          <dt className="flex h-5 items-center text-muted-foreground">
            <UserIcon aria-hidden className="size-4" />
            <span className="sr-only">Cliente</span>
          </dt>
          <dd>
            {client ? (
              <Link href={`/clientes/${client.id}`} className="underline-offset-4 hover:underline">
                {client.name}
              </Link>
            ) : (
              <span className="text-muted-foreground">
                {appointment.clientId ? "Cliente sem acesso" : "Sem cliente vinculado"}
              </span>
            )}
          </dd>

          {appointment.meetingPoint ? (
            <>
              <dt className="flex h-5 items-center text-muted-foreground">
                <MapPinIcon aria-hidden className="size-4" />
                <span className="sr-only">Ponto de encontro</span>
              </dt>
              <dd className="wrap-break-word">{appointment.meetingPoint}</dd>
            </>
          ) : null}
        </dl>
        {isUpcoming ? <AddToCalendarButton appointmentId={appointment.id} /> : null}
      </CardContent>
      {hasReturn ? (
        <CardFooter className="flex-col items-start gap-2">
          {appointment.rating !== null ? (
            <Badge variant="secondary">
              <StarIcon data-icon="inline-start" />
              Nota {appointment.rating}/5
            </Badge>
          ) : null}
          {appointment.feedback ? (
            <p className="wrap-break-word whitespace-pre-line text-muted-foreground">
              {appointment.feedback}
            </p>
          ) : null}
        </CardFooter>
      ) : null}
    </Card>
  )
}

/** Visita passada sem retorno, na lista compacta de pendências. */
export function PendingAppointmentItem({
  appointment,
  members,
  currentUserId,
  role,
  broker,
  showBroker,
}: AppointmentViewProps & { broker: string | null; showBroker: boolean }) {
  const details = [
    appointment.property ? formatPropertyLabel(appointment.property) : "Imóvel indisponível",
    clientLabel(appointment),
    showBroker ? getMemberName(members, appointment.brokerId, "sem corretor") : null,
  ]
    .filter(Boolean)
    .join(" · ")

  return (
    <Item variant="outline" size="sm">
      <ItemContent className="min-w-0">
        <ItemTitle>
          <Link
            href={buildAgendaHref({ day: appointment.dateKey, broker })}
            className="underline-offset-4 hover:underline"
          >
            {formatDateKey(appointment.dateKey)} · {formatTime(appointment.startsAt)}
          </Link>
        </ItemTitle>
        <ItemDescription>{details}</ItemDescription>
      </ItemContent>
      <ItemActions>
        <AppointmentActions
          appointment={appointment}
          members={members}
          currentUserId={currentUserId}
          role={role}
        />
      </ItemActions>
    </Item>
  )
}

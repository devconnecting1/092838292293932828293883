import Link from "next/link"
import { CalendarPlusIcon } from "lucide-react"

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
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
} from "@workspace/ui/components/item"

import { AppointmentFormDialog } from "@/components/agenda/appointment-form-dialog"
import { AppointmentStatusBadge } from "@/components/agenda/appointment-status-badge"
import type { Role } from "@/lib/auth/roles"
import { formatDateTime, formatTime } from "@/lib/format"
import { toDateKey } from "@/lib/agenda/datetime"
import { canScheduleAppointments } from "@/lib/agenda/permissions"
import type { ClientAppointmentItem } from "@/lib/clientes/detail-queries"
import { getMemberName, type ClientOption, type MemberOption } from "@/lib/clientes/options"

type ClientAppointmentsCardProps = {
  appointments: ClientAppointmentItem[]
  failed: boolean
  members: MemberOption[]
  client: ClientOption
  currentUserId: string
  role: Role
  now: Date
}

export function ClientAppointmentsCard({
  appointments,
  failed,
  members,
  client,
  currentUserId,
  role,
  now,
}: ClientAppointmentsCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Visitas</CardTitle>
        <CardDescription>As 10 visitas mais recentes deste cliente.</CardDescription>
        {canScheduleAppointments(role) ? (
          <CardAction>
            <AppointmentFormDialog
              members={members}
              currentUserId={currentUserId}
              role={role}
              defaults={{ client }}
              trigger={<Button variant="outline" size="sm" />}
            >
              <CalendarPlusIcon data-icon="inline-start" />
              Agendar visita
            </AppointmentFormDialog>
          </CardAction>
        ) : null}
      </CardHeader>
      <CardContent>
        {failed ? (
          <p className="text-sm text-destructive">Não foi possível carregar as visitas.</p>
        ) : appointments.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhuma visita agendada.</p>
        ) : (
          <ItemGroup className="gap-1">
            {appointments.map((appointment) => {
              const overdue =
                (appointment.status === "scheduled" || appointment.status === "confirmed") &&
                new Date(appointment.startsAt) < now

              return (
                <Item key={appointment.id} size="sm" variant="outline" role="listitem">
                  <ItemContent className="min-w-0">
                    <ItemTitle>
                      <Link
                        href={`/agenda?dia=${toDateKey(appointment.startsAt)}`}
                        className="tabular-nums underline-offset-4 hover:underline"
                      >
                        {formatDateTime(appointment.startsAt)}
                        {appointment.endsAt ? ` – ${formatTime(appointment.endsAt)}` : ""}
                      </Link>
                    </ItemTitle>
                    <ItemDescription>
                      {appointment.property ? (
                        <Link
                          href={`/imoveis/${appointment.property.id}`}
                          className="underline-offset-4 hover:underline"
                        >
                          {appointment.property.code} · {appointment.property.title}
                        </Link>
                      ) : (
                        "Sem imóvel"
                      )}{" "}
                      · {getMemberName(members, appointment.brokerId, "Sem corretor")}
                    </ItemDescription>
                  </ItemContent>
                  <ItemActions>
                    <AppointmentStatusBadge status={appointment.status} overdue={overdue} />
                  </ItemActions>
                </Item>
              )
            })}
          </ItemGroup>
        )}
      </CardContent>
      <CardFooter>
        <Button
          variant="link"
          className="px-0"
          render={<Link href="/agenda" />}
          nativeButton={false}
        >
          Abrir a agenda
        </Button>
      </CardFooter>
    </Card>
  )
}

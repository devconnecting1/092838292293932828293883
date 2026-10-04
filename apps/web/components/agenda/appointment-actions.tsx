"use client"

import * as React from "react"
import {
  CalendarCheckIcon,
  CalendarXIcon,
  CircleCheckIcon,
  EllipsisVerticalIcon,
  MessageSquareTextIcon,
  PencilIcon,
  RotateCcwIcon,
  Trash2Icon,
  UserXIcon,
} from "lucide-react"

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@workspace/ui/components/alert-dialog"
import { Button } from "@workspace/ui/components/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu"
import { Spinner } from "@workspace/ui/components/spinner"
import { toast } from "@workspace/ui/components/toast"

import { AppointmentFeedbackDialog } from "@/components/agenda/appointment-feedback-dialog"
import { ControlledAppointmentFormDialog } from "@/components/agenda/appointment-form-dialog"
import { deleteAppointment, updateAppointmentStatus } from "@/lib/agenda/actions"
import { formatPropertyLabel, formatVisitMoment } from "@/lib/agenda/labels"
import { canDeleteAppointments, canUpdateAppointment } from "@/lib/agenda/permissions"
import type { AgendaAppointment } from "@/lib/agenda/types"
import type { Role } from "@/lib/auth/roles"
import type { MemberOption } from "@/lib/clientes/options"

type AppointmentActionsProps = {
  appointment: AgendaAppointment
  members: MemberOption[]
  currentUserId: string
  role: Role
}

type QuickStatus = "scheduled" | "confirmed" | "no_show" | "canceled"

/** Menu de ações da visita, conforme o papel (espelho do RLS). */
export function AppointmentActions({
  appointment,
  members,
  currentUserId,
  role,
}: AppointmentActionsProps) {
  const [isPending, startTransition] = React.useTransition()
  const [editOpen, setEditOpen] = React.useState(false)
  const [feedbackOpen, setFeedbackOpen] = React.useState(false)
  const [deleteOpen, setDeleteOpen] = React.useState(false)

  const canUpdate = canUpdateAppointment(
    role,
    { brokerId: appointment.brokerId, createdBy: appointment.createdBy },
    currentUserId
  )
  const canDelete = canDeleteAppointments(role)

  if (!canUpdate && !canDelete) {
    return null
  }

  const { status } = appointment
  const isOpen = status === "scheduled" || status === "confirmed"
  const summary = [
    formatVisitMoment(appointment.startsAt),
    appointment.property ? formatPropertyLabel(appointment.property) : null,
  ]
    .filter(Boolean)
    .join(" · ")

  function changeStatus(nextStatus: QuickStatus) {
    startTransition(async () => {
      const result = await updateAppointmentStatus({
        id: appointment.id,
        status: nextStatus,
      })

      toast.add(
        result.ok
          ? { title: result.message ?? "Visita atualizada.", type: "success" }
          : {
              title: "Não foi possível atualizar a visita",
              description: result.error,
              type: "error",
            }
      )
    })
  }

  function remove() {
    startTransition(async () => {
      const result = await deleteAppointment(appointment.id)

      if (!result.ok) {
        toast.add({
          title: "Não foi possível excluir a visita",
          description: result.error,
          type: "error",
        })
        return
      }

      setDeleteOpen(false)
      toast.add({
        title: result.message ?? "Visita excluída.",
        type: "success",
      })
    })
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={<Button variant="ghost" size="icon-sm" disabled={isPending} />}
        >
          {isPending ? <Spinner /> : <EllipsisVerticalIcon />}
          <span className="sr-only">Ações da visita</span>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          {canUpdate ? (
            <DropdownMenuGroup>
              <DropdownMenuItem onClick={() => setEditOpen(true)}>
                <PencilIcon />
                Editar
              </DropdownMenuItem>
              {status === "scheduled" ? (
                <DropdownMenuItem onClick={() => changeStatus("confirmed")}>
                  <CalendarCheckIcon />
                  Confirmar
                </DropdownMenuItem>
              ) : null}
              {isOpen ? (
                <>
                  <DropdownMenuItem onClick={() => setFeedbackOpen(true)}>
                    <CircleCheckIcon />
                    Marcar como realizada
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => changeStatus("no_show")}>
                    <UserXIcon />
                    Não compareceu
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => changeStatus("canceled")}>
                    <CalendarXIcon />
                    Cancelar visita
                  </DropdownMenuItem>
                </>
              ) : null}
              {status === "done" ? (
                <DropdownMenuItem onClick={() => setFeedbackOpen(true)}>
                  <MessageSquareTextIcon />
                  Editar retorno
                </DropdownMenuItem>
              ) : null}
              {!isOpen ? (
                <DropdownMenuItem onClick={() => changeStatus("scheduled")}>
                  <RotateCcwIcon />
                  Reabrir como agendada
                </DropdownMenuItem>
              ) : null}
            </DropdownMenuGroup>
          ) : null}
          {canUpdate && canDelete ? <DropdownMenuSeparator /> : null}
          {canDelete ? (
            <DropdownMenuGroup>
              <DropdownMenuItem variant="destructive" onClick={() => setDeleteOpen(true)}>
                <Trash2Icon />
                Excluir
              </DropdownMenuItem>
            </DropdownMenuGroup>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>

      {canUpdate ? (
        <>
          <ControlledAppointmentFormDialog
            open={editOpen}
            onOpenChange={setEditOpen}
            members={members}
            currentUserId={currentUserId}
            role={role}
            appointment={{
              id: appointment.id,
              property: appointment.property
                ? {
                    id: appointment.property.id,
                    label: formatPropertyLabel(appointment.property),
                    description: appointment.property.neighborhood,
                  }
                : null,
              // Cliente escondido pelo RLS: mantém o vínculo ao salvar.
              client: appointment.client
                ? {
                    id: appointment.client.id,
                    label: appointment.client.name,
                    description: null,
                  }
                : appointment.clientId
                  ? {
                      id: appointment.clientId,
                      label: "Cliente sem acesso",
                      description: null,
                    }
                  : null,
              brokerId: appointment.brokerId,
              startsAt: appointment.startsAt,
              endsAt: appointment.endsAt,
              meetingPoint: appointment.meetingPoint,
            }}
          />
          <AppointmentFeedbackDialog
            appointmentId={appointment.id}
            summary={summary}
            open={feedbackOpen}
            onOpenChange={setFeedbackOpen}
            defaultRating={appointment.rating}
            defaultFeedback={appointment.feedback}
            offerFollowUp={isOpen}
          />
        </>
      ) : null}

      {canDelete ? (
        <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Excluir esta visita?</AlertDialogTitle>
              <AlertDialogDescription>
                {summary}. A visita some da agenda; o histórico já registrado no cliente continua.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={isPending}>Voltar</AlertDialogCancel>
              <AlertDialogAction variant="destructive" onClick={remove} disabled={isPending}>
                {isPending ? <Spinner data-icon="inline-start" /> : null}
                Excluir visita
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      ) : null}
    </>
  )
}

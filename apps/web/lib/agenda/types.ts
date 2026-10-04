import type { AppointmentStatus } from "@/lib/agenda/schemas"

/** Visita já pronta para a interface (datas-chave calculadas no servidor). */
export type AgendaAppointment = {
  id: string
  status: AppointmentStatus
  startsAt: string
  endsAt: string | null
  /** "AAAA-MM-DD" do início, no calendário de Brasília. */
  dateKey: string
  meetingPoint: string | null
  feedback: string | null
  rating: number | null
  brokerId: string | null
  createdBy: string | null
  propertyId: string | null
  clientId: string | null
  property: {
    id: string
    code: string
    title: string
    neighborhood: string | null
  } | null
  /** null quando não há cliente ou quando o RLS esconde o cliente (ver clientId). */
  client: { id: string; name: string } | null
  /** Agendada/confirmada com início no passado: falta registrar o retorno. */
  overdue: boolean
}

import { CalendarPlusIcon } from "lucide-react"

import { visitCalendarPath } from "@workspace/core/email/reminders"
import { Button } from "@workspace/ui/components/button"

/**
 * Baixa o convite da visita (.ics, RFC 5545) gerado na hora pela rota
 * /agenda/visitas/{id}/convite. No celular, abrir o arquivo oferece o Google
 * Agenda, o Outlook ou o Calendário; no computador, o arquivo importa em
 * qualquer um deles.
 */
export function AddToCalendarButton({ appointmentId }: { appointmentId: string }) {
  return (
    <Button
      variant="outline"
      size="sm"
      className="w-full sm:w-auto"
      render={<a href={visitCalendarPath(appointmentId)} download />}
      nativeButton={false}
    >
      <CalendarPlusIcon data-icon="inline-start" />
      Adicionar ao Google Agenda / Outlook
    </Button>
  )
}

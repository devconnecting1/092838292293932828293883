import { ArrowRightLeftIcon, PhoneCallIcon, PhoneMissedIcon, UserRoundIcon } from "lucide-react"

import { formatDateTime } from "@/lib/format"
import { LEAD_CONTACT_CHANNEL_LABELS, LEAD_STAGE_LABELS } from "@/lib/leads/constants"
import { formatRelativeShort } from "@/lib/leads/format"
import type { LeadHistoryEvent } from "@/lib/leads/types"

/** "Novo → Em contato" ou, no primeiro evento, só a etapa de entrada. */
function stageTitle(event: Extract<LeadHistoryEvent, { kind: "stage" }>) {
  const to = LEAD_STAGE_LABELS[event.toStage]
  return event.fromStage ? `${LEAD_STAGE_LABELS[event.fromStage]} → ${to}` : `Entrou em ${to}`
}

function assignmentTitle(event: Extract<LeadHistoryEvent, { kind: "assignment" }>) {
  const to = event.toName ?? "Sem responsável"
  return event.fromName ? `${event.fromName} → ${to}` : `Responsável: ${to}`
}

/** "Contato por WhatsApp" ou "Tentativa por Ligação, sem resposta". */
function contactTitle(event: Extract<LeadHistoryEvent, { kind: "contact" }>) {
  const channel = LEAD_CONTACT_CHANNEL_LABELS[event.channel]
  return event.reached ? `Contato por ${channel}` : `Tentativa por ${channel}, sem resposta`
}

function eventView(event: LeadHistoryEvent) {
  switch (event.kind) {
    case "stage":
      return { Icon: ArrowRightLeftIcon, title: stageTitle(event) }
    case "assignment":
      return { Icon: UserRoundIcon, title: assignmentTitle(event) }
    case "contact":
      return {
        Icon: event.reached ? PhoneCallIcon : PhoneMissedIcon,
        title: contactTitle(event),
      }
  }
}

/**
 * Linha do tempo do lead (etapas, responsáveis e contatos registrados), do
 * mais antigo para o mais recente: "Novo → Em contato · por Ana · há 2 h".
 */
export function LeadHistoryTimeline({
  events,
  nowMs,
}: {
  events: readonly LeadHistoryEvent[]
  nowMs: number
}) {
  if (events.length === 0) {
    return <p className="text-sm text-muted-foreground">Nenhuma movimentação registrada ainda.</p>
  }

  return (
    <ol className="flex flex-col gap-1.5 text-sm" aria-label="Linha do tempo do lead">
      {events.map((event) => {
        const { Icon, title } = eventView(event)

        return (
          <li key={`${event.kind}-${event.id}`} className="flex items-start gap-2">
            <Icon aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            <span className="min-w-0 wrap-break-word">
              {title}
              <span className="text-muted-foreground">
                {event.reasonLabel ? ` · ${event.reasonLabel}` : ""} · por {event.actorName} ·{" "}
                <time dateTime={event.at} title={formatDateTime(event.at)}>
                  {formatRelativeShort(event.at, nowMs)}
                </time>
              </span>
            </span>
          </li>
        )
      })}
    </ol>
  )
}

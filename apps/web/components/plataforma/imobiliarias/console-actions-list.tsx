import { formatDateTime } from "@/lib/format"
import type { PlatformAuditEvent } from "@/lib/plataforma/audit"

const ACTION_LABELS: Record<string, string> = {
  "organizacao.bloquear": "Bloqueou a conta",
  "organizacao.desbloquear": "Desbloqueou a conta",
  "assinatura.prorrogar_teste": "Prorrogou o teste grátis",
}

function detailText(event: PlatformAuditEvent): string | null {
  if (event.action !== "assinatura.prorrogar_teste") {
    return null
  }

  const after = event.after

  if (typeof after !== "object" || after === null || Array.isArray(after)) {
    return null
  }

  const days = after.dias
  return typeof days === "number" ? `+${days} dias` : null
}

/** Últimas ações do console nesta imobiliária (registro do console). */
export function ConsoleActionsList({ events }: { events: PlatformAuditEvent[] }) {
  if (events.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Nenhuma ação do console nesta imobiliária ainda.
      </p>
    )
  }

  return (
    <ul className="flex flex-col divide-y">
      {events.map((event) => {
        const detail = detailText(event)

        return (
          <li key={event.id} className="flex min-w-0 flex-col gap-1 py-3 first:pt-0 last:pb-0">
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
              <span className="text-sm font-medium">
                {ACTION_LABELS[event.action] ?? event.action}
                {detail ? ` (${detail})` : ""}
              </span>
              <span className="text-xs text-muted-foreground tabular-nums">
                {formatDateTime(event.occurredAt)}
              </span>
            </div>
            <p className="text-xs break-all text-muted-foreground">Por {event.actorEmail}</p>
            {event.reason ? (
              <p className="text-sm break-words">
                <span className="text-muted-foreground">Motivo: </span>
                {event.reason}
              </p>
            ) : null}
          </li>
        )
      })}
    </ul>
  )
}

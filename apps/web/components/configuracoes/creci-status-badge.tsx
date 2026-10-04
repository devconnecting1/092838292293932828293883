import { CircleCheckIcon, ClockIcon, TriangleAlertIcon } from "lucide-react"

import { Badge } from "@workspace/ui/components/badge"

import { getCreciStatus } from "@/lib/configuracoes/dates"

/** Situação da validade do CRECI. `today` vem do servidor (AAAA-MM-DD, Brasília). */
export function CreciStatusBadge({
  validUntil,
  today,
}: {
  validUntil: string | null | undefined
  today: string
}) {
  const status = getCreciStatus(validUntil, today)

  if (status === "missing") {
    return null
  }

  if (status === "expired") {
    return (
      <Badge variant="destructive">
        <TriangleAlertIcon data-icon="inline-start" />
        Vencido
      </Badge>
    )
  }

  if (status === "expiring") {
    return (
      <Badge variant="secondary">
        <ClockIcon data-icon="inline-start" />
        Vence em até 30 dias
      </Badge>
    )
  }

  return (
    <Badge variant="outline">
      <CircleCheckIcon data-icon="inline-start" />
      Em dia
    </Badge>
  )
}

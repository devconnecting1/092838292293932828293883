import {
  BanIcon,
  CircleCheckIcon,
  CircleSlashIcon,
  HourglassIcon,
  TriangleAlertIcon,
  type LucideIcon,
} from "lucide-react"

import { ACCOUNT_SITUATION_LABELS, type AccountSituation } from "@workspace/core/platform/accounts"
import { Badge } from "@workspace/ui/components/badge"

const VARIANTS: Record<
  AccountSituation,
  { variant: "secondary" | "outline" | "destructive"; icon: LucideIcon }
> = {
  teste: { variant: "outline", icon: HourglassIcon },
  ativa: { variant: "secondary", icon: CircleCheckIcon },
  em_atraso: { variant: "destructive", icon: TriangleAlertIcon },
  cancelada: { variant: "outline", icon: CircleSlashIcon },
  bloqueada: { variant: "destructive", icon: BanIcon },
}

/** Situação da assinatura com ícone e texto (a cor nunca é o único sinal). */
export function AccountSituationBadge({ situation }: { situation: AccountSituation }) {
  const { variant, icon: Icon } = VARIANTS[situation]

  return (
    <Badge variant={variant}>
      <Icon data-icon="inline-start" />
      {ACCOUNT_SITUATION_LABELS[situation]}
    </Badge>
  )
}

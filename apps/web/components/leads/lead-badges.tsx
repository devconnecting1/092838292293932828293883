import { ClockIcon, CopyIcon, MegaphoneIcon, RefreshCwIcon, TimerIcon } from "lucide-react"

import { Badge } from "@workspace/ui/components/badge"

import { LEAD_SOURCE_LABELS, LEAD_STAGE_LABELS } from "@/lib/leads/constants"
import type { LeadStage } from "@/lib/leads/db-types"
import {
  DEFAULT_LEAD_SLA_CONFIG,
  formatDurationShort,
  formatElapsedShort,
  getLeadSlaView,
  isLeadWithoutContact,
  LEAD_AD_PLATFORM_LABELS,
  type LeadAdPlatform,
  type LeadSlaConfig,
} from "@/lib/leads/format"
import type { LeadItem } from "@/lib/leads/types"

const STAGE_BADGE_VARIANT: Record<LeadStage, "default" | "secondary" | "outline" | "destructive"> =
  {
    new: "default",
    contacted: "outline",
    qualified: "outline",
    visit_scheduled: "outline",
    proposal: "outline",
    won: "secondary",
    lost: "destructive",
  }

export function LeadStageBadge({ stage }: { stage: LeadStage }) {
  return <Badge variant={STAGE_BADGE_VARIANT[stage]}>{LEAD_STAGE_LABELS[stage]}</Badge>
}

/** Origem; para landing page mostra o nome da página. */
export function LeadSourceBadge({ lead }: { lead: Pick<LeadItem, "source" | "landingPage"> }) {
  const isLandingPage = lead.source === "landing_page" && lead.landingPage
  const label =
    isLandingPage && lead.landingPage ? lead.landingPage.name : LEAD_SOURCE_LABELS[lead.source]

  return (
    <Badge
      variant="outline"
      className="max-w-full"
      title={isLandingPage ? `Landing page: ${label}` : label}
    >
      <span className="truncate">{label}</span>
    </Badge>
  )
}

export function LeadAdPlatformBadges({ platforms }: { platforms: readonly LeadAdPlatform[] }) {
  return platforms.map((platform) => (
    <Badge key={platform} variant="secondary">
      <MegaphoneIcon data-icon="inline-start" />
      {LEAD_AD_PLATFORM_LABELS[platform]}
    </Badge>
  ))
}

type ContactTimerLead = Pick<
  LeadItem,
  "stage" | "firstContactAt" | "createdAt" | "assignedAt" | "firstResponseDueAt"
>

/**
 * Cronômetro do primeiro contato, com o prazo que a imobiliária configurou
 * (`lead_routing_settings.sla_minutes`). Três estados: dentro do prazo
 * (discreto), vai estourar (sólido, chama atenção) e fora do prazo (destrutivo).
 * O tema é neutro, então a escala é de contraste, não de cor.
 */
export function LeadContactTimerBadge({
  lead,
  nowMs,
  sla = DEFAULT_LEAD_SLA_CONFIG,
}: {
  lead: ContactTimerLead
  nowMs: number
  sla?: LeadSlaConfig
}) {
  if (!isLeadWithoutContact(lead)) {
    return null
  }

  const { state, dueAtMs, minutesLeft, overdueMs } = getLeadSlaView(lead, nowMs, sla)
  const target = `Meta da imobiliária: primeiro contato em até ${sla.slaMinutes} min.`
  const elapsed = formatElapsedShort(lead.createdAt, nowMs)
  // Prazos longos ficam ilegíveis em minutos ("faltam 1200 min").
  const remaining =
    minutesLeft < 60 || dueAtMs === null
      ? `${minutesLeft} min`
      : formatDurationShort(dueAtMs - nowMs)

  if (state === "breached") {
    return (
      <Badge variant="destructive" title={`Fora do prazo. ${target}`}>
        <TimerIcon data-icon="inline-start" />
        Fora do prazo há {formatDurationShort(overdueMs)}
      </Badge>
    )
  }

  if (state === "warning") {
    return (
      <Badge variant="default" title={`O prazo está acabando. ${target}`}>
        <TimerIcon data-icon="inline-start" />
        Faltam {remaining}
      </Badge>
    )
  }

  return (
    <Badge variant="secondary" title={`Sem contato há ${elapsed}. ${target}`}>
      <TimerIcon data-icon="inline-start" />
      {state === "ok" ? `Faltam ${remaining}` : `Sem contato há ${elapsed}`}
    </Badge>
  )
}

/** Lead que já voltou para a roleta por estourar o prazo (sinal de gargalo). */
export function LeadReassignedBadge({ count }: { count: number }) {
  if (count <= 0) {
    return null
  }

  return (
    <Badge
      variant="outline"
      title={`O prazo de primeiro contato estourou ${count}x e o lead voltou para o rodízio.`}
    >
      <RefreshCwIcon data-icon="inline-start" />
      Redistribuído {count}x
    </Badge>
  )
}

/** Lead sorteado fora do horário de plantão: espera a próxima janela do rodízio. */
export function LeadWaitingShiftBadge({ routingDueAt }: { routingDueAt: string | null }) {
  if (!routingDueAt) {
    return null
  }

  return (
    <Badge
      variant="outline"
      title="Ninguém de plantão quando o lead chegou: o rodízio entrega na próxima janela."
    >
      <ClockIcon data-icon="inline-start" />
      Aguardando plantão
    </Badge>
  )
}

/**
 * `hasDuplicate` vem da RPC `lead_duplicate_flags` (nunca expõe o registro
 * duplicado, então o rótulo não cita quantidade nem detalhes).
 */
export function LeadDuplicateBadge({ hasDuplicate }: { hasDuplicate: boolean }) {
  if (!hasDuplicate) {
    return null
  }

  return (
    <Badge
      variant="outline"
      title="Outro lead ou cliente da imobiliária com o mesmo telefone ou e-mail nos últimos 90 dias."
    >
      <CopyIcon data-icon="inline-start" />
      Possível duplicado
    </Badge>
  )
}

/** Selos de rodízio e SLA que aparecem juntos no card, na lista e no detalhe. */
export function LeadRoutingBadges({
  lead,
  nowMs,
  sla,
}: {
  lead: ContactTimerLead & Pick<LeadItem, "slaReassignments" | "routingDueAt">
  nowMs: number
  sla?: LeadSlaConfig
}) {
  return (
    <>
      <LeadContactTimerBadge lead={lead} nowMs={nowMs} sla={sla} />
      <LeadWaitingShiftBadge routingDueAt={lead.routingDueAt} />
      <LeadReassignedBadge count={lead.slaReassignments} />
    </>
  )
}

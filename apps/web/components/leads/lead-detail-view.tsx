"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { ArrowLeftIcon } from "lucide-react"

import { Button } from "@workspace/ui/components/button"

import {
  LeadDuplicateBadge,
  LeadRoutingBadges,
  LeadSourceBadge,
  LeadStageBadge,
} from "@/components/leads/lead-badges"
import { LeadDetail } from "@/components/leads/lead-detail"
import { LostReasonDialog } from "@/components/leads/lost-reason-dialog"
import { useLeadMutations } from "@/components/leads/use-lead-mutations"
import { useNow } from "@/components/leads/use-now"
import type { Role } from "@/lib/auth/roles"
import type { MemberOption } from "@/lib/clientes/options"
import { LEADS_PATH } from "@/lib/leads/constants"
import type { LeadDetailExtras, LeadItem, LeadSlaSettings } from "@/lib/leads/types"

type LeadDetailViewProps = {
  lead: LeadItem
  members: MemberOption[]
  extras: LeadDetailExtras
  currentUserId: string
  role: Role
  nowMs: number
  sla: LeadSlaSettings
}

/** Página própria do lead (/leads/[id]), com as mesmas ações do painel lateral. */
export function LeadDetailView({
  lead,
  members,
  extras,
  currentUserId,
  role,
  nowMs,
  sla,
}: LeadDetailViewProps) {
  const router = useRouter()
  const now = useNow(nowMs)
  const mutations = useLeadMutations([lead], { managePositions: false })
  const current = mutations.leads[0] ?? lead

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <Button
          variant="ghost"
          size="sm"
          className="w-fit"
          render={<Link href={LEADS_PATH} />}
          nativeButton={false}
        >
          <ArrowLeftIcon data-icon="inline-start" />
          Voltar ao funil
        </Button>
        <div className="flex flex-col gap-2">
          <h1 className="text-2xl font-semibold tracking-tight wrap-break-word">{current.name}</h1>
          <div className="flex flex-wrap items-center gap-1.5">
            <LeadStageBadge stage={current.stage} />
            <LeadSourceBadge lead={current} />
            <LeadRoutingBadges lead={current} nowMs={now} sla={sla} />
            <LeadDuplicateBadge hasDuplicate={current.hasDuplicate} />
          </div>
        </div>
      </div>

      <LeadDetail
        lead={current}
        members={members}
        currentUserId={currentUserId}
        role={role}
        nowMs={now}
        sla={sla}
        extras={extras}
        extrasError={null}
        isPending={mutations.isPending}
        onStageChange={(stage) => mutations.moveLead(current.id, stage, null)}
        onAssign={(assigneeId) => mutations.assignLead(current.id, assigneeId)}
        onMarkContacted={(contact) => mutations.registerContact(current.id, contact)}
        onConverted={() => router.refresh()}
        onActivityAdded={() => router.refresh()}
        onDeleted={() => router.push(LEADS_PATH)}
        showOpenPageLink={false}
      />

      <LostReasonDialog
        open={mutations.lostRequest !== null}
        leadName={mutations.lostRequest?.leadName ?? null}
        onConfirm={mutations.confirmLostMove}
        onCancel={mutations.cancelLostMove}
      />

      <p aria-live="polite" className="sr-only">
        {mutations.announcement}
      </p>
    </div>
  )
}

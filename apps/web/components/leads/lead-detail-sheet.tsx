"use client"

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@workspace/ui/components/sheet"

import {
  LeadDuplicateBadge,
  LeadRoutingBadges,
  LeadSourceBadge,
  LeadStageBadge,
} from "@/components/leads/lead-badges"
import { LeadDetail, type LeadDetailProps } from "@/components/leads/lead-detail"
import { LeadViewLogger } from "@/components/leads/lead-view-logger"
import type { LeadItem } from "@/lib/leads/types"

type LeadDetailSheetProps = Omit<LeadDetailProps, "lead" | "showOpenPageLink"> & {
  lead: LeadItem | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

/** Detalhe do lead em painel lateral, aberto a partir do card ou da lista. */
export function LeadDetailSheet({ lead, open, onOpenChange, ...detail }: LeadDetailSheetProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full data-[side=right]:sm:max-w-xl">
        {lead ? (
          <>
            <LeadViewLogger leadId={lead.id} />
            <SheetHeader className="pe-12">
              <SheetTitle className="wrap-break-word">{lead.name}</SheetTitle>
              <SheetDescription className="flex flex-wrap items-center gap-1.5">
                <LeadStageBadge stage={lead.stage} />
                <LeadSourceBadge lead={lead} />
                <LeadRoutingBadges lead={lead} nowMs={detail.nowMs} sla={detail.sla} />
                <LeadDuplicateBadge hasDuplicate={lead.hasDuplicate} />
              </SheetDescription>
            </SheetHeader>
            <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 pb-6">
              <LeadDetail key={lead.id} {...detail} lead={lead} showOpenPageLink />
            </div>
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  )
}

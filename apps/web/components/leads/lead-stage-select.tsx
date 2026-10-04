"use client"

import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select"

import { isLeadStage, LEAD_STAGE_LABELS, LEAD_STAGES } from "@/lib/leads/constants"
import type { LeadStage } from "@/lib/leads/db-types"

const STAGE_ITEMS = LEAD_STAGES.map((stage) => ({
  label: LEAD_STAGE_LABELS[stage],
  value: stage,
}))

type LeadStageSelectProps = {
  id?: string
  value: LeadStage
  onValueChange: (stage: LeadStage) => void
  disabled?: boolean
  size?: "sm" | "default"
  className?: string
  "aria-label"?: string
}

/** Etapa do funil por Select (alternativa acessível ao arrastar). */
export function LeadStageSelect({
  id,
  value,
  onValueChange,
  disabled,
  size = "default",
  className,
  "aria-label": ariaLabel,
}: LeadStageSelectProps) {
  return (
    <Select
      items={STAGE_ITEMS}
      value={value}
      onValueChange={(next) => {
        if (isLeadStage(next) && next !== value) onValueChange(next)
      }}
      disabled={disabled}
    >
      <SelectTrigger id={id} size={size} className={className} aria-label={ariaLabel}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          {STAGE_ITEMS.map((item) => (
            <SelectItem key={item.value} value={item.value}>
              {item.label}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  )
}

import { Building2Icon } from "lucide-react"

import { cn } from "@workspace/ui/lib/utils"

export const APP_NAME = "CRM Imobiliário"

export function BrandMark({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "flex size-6 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground",
        className
      )}
    >
      <Building2Icon className="size-4" />
    </div>
  )
}

export function BrandLogo({ className }: { className?: string }) {
  return (
    <span className={cn("flex items-center gap-2 font-medium", className)}>
      <BrandMark />
      {APP_NAME}
    </span>
  )
}

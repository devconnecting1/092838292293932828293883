import { Skeleton } from "@workspace/ui/components/skeleton"

import { PageShell } from "@/components/shared/page-shell"

export default function LeadLoading() {
  return (
    <PageShell variant="record" aria-busy="true">
      <div className="flex flex-col gap-3">
        <Skeleton className="h-7 w-32" />
        <Skeleton className="h-8 w-72 max-w-full" />
        <div className="flex gap-1.5">
          <Skeleton className="h-5 w-16 rounded-full" />
          <Skeleton className="h-5 w-24 rounded-full" />
          <Skeleton className="h-5 w-28 rounded-full" />
        </div>
      </div>
      {Array.from({ length: 5 }, (_, index) => (
        <div key={index} className="flex flex-col gap-3">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-3/4" />
        </div>
      ))}
    </PageShell>
  )
}

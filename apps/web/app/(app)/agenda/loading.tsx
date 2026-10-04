import { Skeleton } from "@workspace/ui/components/skeleton"

import { PageShell } from "@/components/shared/page-shell"

export default function AgendaLoading() {
  return (
    <PageShell aria-busy="true">
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div className="flex flex-col gap-2">
          <Skeleton className="h-7 w-28" />
          <Skeleton className="h-4 w-80 max-w-full" />
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Skeleton className="h-8 w-full sm:w-60" />
          <Skeleton className="h-8 w-full sm:w-32" />
        </div>
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-[20rem_minmax(0,1fr)]">
        <div className="flex flex-col gap-6">
          <Skeleton className="h-96 w-full rounded-xl" />
          <Skeleton className="h-40 w-full rounded-xl" />
        </div>
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Skeleton className="h-6 w-64 max-w-full" />
            <Skeleton className="h-4 w-24" />
          </div>
          {[0, 1, 2].map((index) => (
            <Skeleton key={index} className="h-36 w-full rounded-xl" />
          ))}
        </div>
      </div>
    </PageShell>
  )
}

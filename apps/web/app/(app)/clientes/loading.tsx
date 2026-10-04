import { Skeleton } from "@workspace/ui/components/skeleton"

import { PageShell } from "@/components/shared/page-shell"

export default function ClientesLoading() {
  return (
    <PageShell>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex flex-col gap-2">
          <Skeleton className="h-8 w-40" />
          <Skeleton className="h-4 w-80 max-w-full" />
        </div>
        <Skeleton className="h-8 w-32" />
      </div>
      <div className="flex flex-col gap-2 md:flex-row">
        <Skeleton className="h-8 w-full md:max-w-sm" />
        <Skeleton className="h-8 w-full md:w-40" />
        <Skeleton className="h-8 w-full md:w-40" />
        <Skeleton className="h-8 w-full md:w-40" />
      </div>
      <div className="flex flex-col gap-3 rounded-lg border p-3">
        <Skeleton className="h-6 w-full" />
        {Array.from({ length: 8 }, (_, index) => (
          <Skeleton key={index} className="h-10 w-full" />
        ))}
      </div>
    </PageShell>
  )
}

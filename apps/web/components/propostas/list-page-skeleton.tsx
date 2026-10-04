import { Skeleton } from "@workspace/ui/components/skeleton"

import { PageShell } from "@/components/shared/page-shell"

/** Carregamento das listas de chaves, propostas e captações. */
export function ListPageSkeleton({ withSummary = false }: { withSummary?: boolean }) {
  return (
    <PageShell aria-busy="true">
      <span className="sr-only">Carregando…</span>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex flex-col gap-2">
          <Skeleton className="h-8 w-40" />
          <Skeleton className="h-4 w-80 max-w-full" />
        </div>
        <Skeleton className="h-8 w-36" />
      </div>
      {withSummary ? <Skeleton className="h-28 w-full" /> : null}
      <div className="flex flex-wrap gap-3">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-8 w-72 max-w-full" />
        <Skeleton className="h-8 w-40" />
      </div>
      <div className="flex flex-col gap-2">
        {Array.from({ length: 6 }, (_, index) => (
          <Skeleton key={index} className="h-12 w-full" />
        ))}
      </div>
    </PageShell>
  )
}

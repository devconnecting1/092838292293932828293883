import { Skeleton } from "@workspace/ui/components/skeleton"

import { PageShell } from "@/components/shared/page-shell"

export default function RelatoriosLoading() {
  return (
    <PageShell aria-busy="true">
      <span className="sr-only">Carregando…</span>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex flex-col gap-2">
          <Skeleton className="h-8 w-44" />
          <Skeleton className="h-4 w-96 max-w-full" />
        </div>
        <Skeleton className="h-8 w-56" />
      </div>
      <Skeleton className="h-16 w-full" />
      <div className="flex flex-wrap gap-3">
        <Skeleton className="h-9 w-56" />
        <Skeleton className="h-9 w-60" />
      </div>
      <Skeleton className="h-8 w-80 max-w-full" />
      <Skeleton className="h-96 w-full rounded-xl" />
    </PageShell>
  )
}

import { Skeleton } from "@workspace/ui/components/skeleton"

import { PageShell } from "@/components/shared/page-shell"

export default function CondominiosLoading() {
  return (
    <PageShell aria-busy="true">
      <span className="sr-only">Carregando condomínios…</span>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex flex-col gap-2">
          <Skeleton className="h-8 w-44" />
          <Skeleton className="h-4 w-96 max-w-full" />
        </div>
        <Skeleton className="h-8 w-40" />
      </div>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Skeleton className="h-8 w-full sm:max-w-md" />
        <Skeleton className="h-8 w-20" />
      </div>
      <div className="hidden flex-col gap-2 md:flex">
        <Skeleton className="h-10 w-full" />
        {Array.from({ length: 8 }, (_, index) => (
          <Skeleton key={index} className="h-12 w-full" />
        ))}
      </div>
      <div className="flex flex-col gap-3 md:hidden">
        {Array.from({ length: 4 }, (_, index) => (
          <Skeleton key={index} className="h-44 w-full rounded-xl" />
        ))}
      </div>
    </PageShell>
  )
}

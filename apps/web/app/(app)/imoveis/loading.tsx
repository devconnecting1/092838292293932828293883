import { Card, CardContent } from "@workspace/ui/components/card"
import { Skeleton } from "@workspace/ui/components/skeleton"

import { PageShell } from "@/components/shared/page-shell"

export default function ImoveisLoading() {
  return (
    <PageShell aria-busy="true" aria-label="Carregando imóveis">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex flex-col gap-2">
          <Skeleton className="h-7 w-32" />
          <Skeleton className="h-4 w-72" />
        </div>
        <Skeleton className="h-8 w-32" />
      </div>
      <Card>
        <CardContent className="flex flex-col gap-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {Array.from({ length: 4 }, (_, index) => (
              <Skeleton key={index} className="h-14" />
            ))}
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
            {Array.from({ length: 4 }, (_, index) => (
              <Skeleton key={index} className="h-14" />
            ))}
          </div>
        </CardContent>
      </Card>
      <Skeleton className="h-4 w-40" />
      <div className="flex flex-col gap-2">
        {Array.from({ length: 6 }, (_, index) => (
          <div
            key={index}
            className="flex items-center gap-4 rounded-xl p-2 ring-1 ring-foreground/10"
          >
            <Skeleton className="h-14 w-20 shrink-0" />
            <div className="flex flex-1 flex-col gap-2">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-4 w-3/5" />
              <Skeleton className="h-3 w-2/5" />
            </div>
            <Skeleton className="hidden h-5 w-24 md:block" />
            <Skeleton className="hidden h-5 w-16 md:block" />
          </div>
        ))}
      </div>
    </PageShell>
  )
}

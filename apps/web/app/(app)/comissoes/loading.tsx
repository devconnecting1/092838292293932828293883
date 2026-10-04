import { Card, CardContent, CardHeader } from "@workspace/ui/components/card"
import { Skeleton } from "@workspace/ui/components/skeleton"

import { PageShell } from "@/components/shared/page-shell"

export default function ComissoesLoading() {
  return (
    <PageShell
      aria-busy="true"
      header={
        <div className="flex flex-col gap-2">
          <Skeleton className="h-8 w-44" />
          <Skeleton className="h-4 w-96 max-w-full" />
        </div>
      }
    >
      <div className="grid gap-4 @min-[40rem]/page:grid-cols-3">
        {[0, 1, 2].map((card) => (
          <Skeleton key={card} className="h-28 w-full" />
        ))}
      </div>

      <Card>
        <CardHeader>
          <Skeleton className="h-5 w-28" />
          <Skeleton className="h-4 w-full max-w-xl" />
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {[0, 1, 2, 3, 4].map((row) => (
            <div key={row} className="flex items-center gap-3">
              <div className="flex flex-1 flex-col gap-2">
                <Skeleton className="h-4 w-56" />
                <Skeleton className="h-3 w-72 max-w-full" />
              </div>
              <Skeleton className="hidden h-5 w-24 sm:block" />
              <Skeleton className="h-5 w-24" />
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <Skeleton className="h-5 w-48" />
          <Skeleton className="h-4 w-full max-w-lg" />
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {[0, 1].map((row) => (
            <Skeleton key={row} className="h-20 w-full" />
          ))}
        </CardContent>
      </Card>
    </PageShell>
  )
}

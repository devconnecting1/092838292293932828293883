import { Card, CardContent, CardHeader } from "@workspace/ui/components/card"
import { Skeleton } from "@workspace/ui/components/skeleton"

import { PageShell } from "@/components/shared/page-shell"

export default function MarketingInvestmentsLoading() {
  return (
    <PageShell
      aria-busy="true"
      header={
        <div className="flex flex-col gap-2">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-4 w-96 max-w-full" />
        </div>
      }
    >
      <Skeleton className="h-14 w-full" />

      <div className="grid gap-4 @min-[64rem]/page:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Card>
          <CardHeader>
            <Skeleton className="h-5 w-32" />
            <Skeleton className="h-4 w-64 max-w-full" />
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {[0, 1, 2, 3].map((row) => (
              <Skeleton key={row} className="h-10 w-full" />
            ))}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <Skeleton className="h-5 w-40" />
            <Skeleton className="h-8 w-32" />
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {[0, 1, 2].map((row) => (
              <Skeleton key={row} className="h-8 w-full" />
            ))}
          </CardContent>
        </Card>
      </div>

      <Skeleton className="h-48 w-full" />
    </PageShell>
  )
}

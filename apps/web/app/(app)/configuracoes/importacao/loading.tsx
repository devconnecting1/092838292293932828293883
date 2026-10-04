import { Card, CardContent, CardHeader } from "@workspace/ui/components/card"
import { Skeleton } from "@workspace/ui/components/skeleton"

import { PageShell } from "@/components/shared/page-shell"

export default function ImportacaoLoading() {
  return (
    <PageShell
      variant="settings"
      width="wide"
      aria-busy="true"
      header={
        <div className="flex flex-col gap-2">
          <Skeleton className="h-8 w-56" />
          <Skeleton className="h-4 w-96 max-w-full" />
        </div>
      }
    >
      <div className="flex gap-2">
        {[0, 1, 2, 3, 4].map((step) => (
          <Skeleton key={step} className="h-1 flex-1" />
        ))}
      </div>
      <Card>
        <CardHeader>
          <Skeleton className="h-5 w-48" />
          <Skeleton className="h-4 w-72 max-w-full" />
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {[0, 1, 2].map((option) => (
            <Skeleton key={option} className="h-20 w-full" />
          ))}
        </CardContent>
      </Card>
    </PageShell>
  )
}

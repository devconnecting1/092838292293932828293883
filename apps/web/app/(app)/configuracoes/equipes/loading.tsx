import { Card, CardContent, CardHeader } from "@workspace/ui/components/card"
import { Skeleton } from "@workspace/ui/components/skeleton"

import { PageShell } from "@/components/shared/page-shell"

export default function EquipesLoading() {
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
      <Skeleton className="h-20 w-full" />

      <div className="grid gap-4 @min-[64rem]/page:grid-cols-2">
        {[0, 1].map((card) => (
          <Card key={card}>
            <CardHeader>
              <Skeleton className="h-5 w-40" />
              <Skeleton className="h-4 w-56 max-w-full" />
            </CardHeader>
            <CardContent className="flex flex-col gap-2">
              {[0, 1, 2].map((row) => (
                <Skeleton key={row} className="h-11 w-full" />
              ))}
            </CardContent>
          </Card>
        ))}
      </div>

      <Skeleton className="h-40 w-full" />
    </PageShell>
  )
}
